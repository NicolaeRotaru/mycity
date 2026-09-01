import type { SupabaseClient } from '@supabase/supabase-js';
import { refundOrder } from '@/lib/stripe/payout';
import { isStripeConfigured } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';

/**
 * ANNULLARE UN ORDINE VUOL DIRE ANCHE RESTITUIRE I SOLDI.
 *
 * Difetto bloccante trovato dalla radiografia del 21/8/2026. L'annullamento del
 * cliente e il rifiuto del negozio passavano da due funzioni del database
 * (`cancel_order`, `seller_reject_order`) che facevano due cose sole: mettere
 * l'ordine in CANCELED e rimettere la merce a magazzino. Del denaro non si
 * occupava nessuno.
 *
 * Un ordine pagato con carta finiva annullato con i soldi ancora da noi. Il
 * cliente leggeva «Niente addebiti» e sull'estratto conto l'addebito c'era.
 * Nessun processo li restituiva: restavano finché qualcuno non se ne accorgeva
 * a mano. Stessa cosa per il credito MyCity speso sull'ordine.
 *
 * La logica giusta esisteva già, ma in un posto solo: la rotta di annullamento
 * dell'amministrazione. Era una copia unica dentro un percorso che il cliente
 * non attraversa mai. Ora sta qui, e la usano tutti e tre.
 */

export type EsitoAnnullo =
  | { ok: true; refundId: string | null }
  | {
      ok: false;
      motivo:
        | 'CONTANTI_INCASSATI'
        | 'STRIPE_NON_CONFIGURATO'
        | 'RIMBORSO_FALLITO'
        | 'ANNULLAMENTO_FALLITO'
        | 'GIA_ANNULLATO';
      dettaglio?: string;
    };

/**
 * I campi che servono per decidere cosa fare dei soldi.
 *
 * 27/8/2026 (R121) — `coupon_code` MANCAVA, quindi il codice sconto non veniva
 * nemmeno letto: chi annullava restava senza buono senza aver comprato niente.
 */
export const COLONNE_ANNULLO =
  'id, user_id, seller_id, total_price, payment_method, payment_status, delivery_status, ' +
  'stripe_payment_intent, wallet_applied_cents, cash_confirmed_at, refunded_amount_cents, coupon_code';

export type OrdineDaAnnullare = {
  id: string;
  user_id: string;
  seller_id?: string | null;
  total_price: number | string;
  payment_method: string | null;
  payment_status: string | null;
  delivery_status: string | null;
  stripe_payment_intent: string | null;
  wallet_applied_cents?: number | null;
  cash_confirmed_at?: string | null;
  refunded_amount_cents?: number | null;
  coupon_code?: string | null;
};

/**
 * Porta l'ordine ad annullato e rimette a posto il denaro: rimborso sulla carta
 * se era pagato, credito MyCity restituito se ne era stato usato, merce a
 * magazzino. NON decide CHI può annullare: quello resta a chi la chiama.
 */
export async function annullaERimborsa(
  admin: SupabaseClient,
  order: OrdineDaAnnullare,
  opts: { reason: string; metadata?: Record<string, string>; motivoCredito?: string },
): Promise<EsitoAnnullo> {
  // 053 — Un ordine già rimborsato in parte ha stato 'PARTIALLY_REFUNDED':
  // trattarlo come «niente da rimborsare» lasciava indietro il residuo, cioè la
  // parte di soldi che il cliente non aveva mai riavuto.
  const isPaidCard =
    order.payment_method === 'card' &&
    !!order.stripe_payment_intent &&
    (order.payment_status === 'PAID' || order.payment_status === 'PARTIALLY_REFUNDED');

  // Il credito MyCity speso sull'ordine torna al cliente: senza, l'annullamento
  // gli costa comunque quei soldi. Vale su entrambi i rami, carta compresa.
  // Non lancia mai: sul ramo carta viene chiamata a rimborso gia' emesso, e un
  // errore qui non deve far raccontare al chiamante che il rimborso e' fallito.
  async function restituisciCredito(): Promise<void> {
    const walletCents = Number(order.wallet_applied_cents ?? 0);
    if (walletCents <= 0) return;
    try {
      const { error: wErr } = await admin.rpc('wallet_credit', {
        p_user: order.user_id,
        p_cents: walletCents,
        p_reason: opts.motivoCredito ?? 'order_canceled',
        p_ref: order.id,
      });
      if (wErr) logger.warn('[annullaERimborsa] storno credito fallito', { orderId: order.id, err: wErr.message });
    } catch (err) {
      logger.warn('[annullaERimborsa] storno credito fallito', { orderId: order.id, err });
    }
  }

  /**
   * 27/8/2026 (R121) — IL CODICE SCONTO RESTAVA BRUCIATO.
   *
   * Il codice si consuma in modo atomico prima di creare l'ordine
   * (`claim_coupon`). La restituzione (`release_coupon`) esisteva, ma la
   * chiamavano solo il rifiuto del negozio e i rimbalzi del carrello: dal
   * 21/8 il pulsante «Annulla ordine» del cliente passa di qui, e di qui non
   * la chiamava nessuno. Il cliente perdeva il buono di benvenuto senza aver
   * comprato niente, e lo scopriva premendo «Applica» — cioè mentre stava
   * riprovando a ordinare.
   *
   * `release_coupon` non scende mai sotto zero, quindi una restituzione di
   * troppo non fa danno: è un no-op.
   */
  async function restituisciCoupon(): Promise<void> {
    const codice = order.coupon_code?.trim();
    if (!codice) return;
    try {
      const { error: cErr } = await admin.rpc('release_coupon', { p_code: codice });
      if (cErr) logger.warn('[annullaERimborsa] codice sconto non restituito', { orderId: order.id, err: cErr.message });
    } catch (err) {
      logger.warn('[annullaERimborsa] codice sconto non restituito', { orderId: order.id, err });
    }
  }

  // Contanti già incassati dal fattorino: la restituzione è un fatto fisico e la
  // decide una persona. Annullare in silenzio lascerebbe il cliente senza merce
  // e senza soldi.
  if (order.payment_method === 'cod' && !!order.cash_confirmed_at) {
    return { ok: false, motivo: 'CONTANTI_INCASSATI' };
  }

  if (isPaidCard) {
    if (!isStripeConfigured()) return { ok: false, motivo: 'STRIPE_NON_CONFIGURATO' };
    try {
      const totaleCent = Math.round(Number(order.total_price) * 100);
      const giaRimborsato = Number(order.refunded_amount_cents ?? 0);
      const residuoCent = Math.max(0, totaleCent - giaRimborsato);
      const res = await refundOrder({
        orderId: order.id,
        amountCents: residuoCent,
        reason: opts.reason,
        metadata: opts.metadata,
        notifyBuyer: true,
      });
      // refundOrder ha già impostato CANCELED + canceled_at + payment_status.
      //
      // 28/8/2026 — IL CREDITO TORNA ANCHE QUI. Il rimborso sulla carta copre
      // `total_price`, che è il totale DOPO lo scomputo del credito MyCity: il
      // credito speso sull'ordine è un'altra somma, e su questo ramo non lo
      // restituiva nessuno. Un ordine da 30 € pagato con 20 € di credito e 10 €
      // di carta si annullava restituendo 10 €. La funzione del database che
      // faceva il rifiuto del negozio lo restituiva già: senza questa riga,
      // farlo passare di qui sarebbe un passo indietro per chi compra.
      await restituisciCredito();
      await restituisciCoupon();
      return { ok: true, refundId: res.refundId };
    } catch (err) {
      logger.error('[annullaERimborsa] rimborso fallito', { orderId: order.id, err });
      return { ok: false, motivo: 'RIMBORSO_FALLITO', dettaglio: err instanceof Error ? err.message : undefined };
    }
  }

  /**
   * 27/8/2026 (R131) — IL TURNO SI PRENDE CON LA SCRITTURA, NON PRIMA.
   *
   * L'UPDATE non aveva nessuna condizione sullo stato di partenza: la guardia
   * viveva solo nel `if` JavaScript dei chiamanti, e fra la lettura e la
   * scrittura non c'era niente. Due annulli sovrapposti — il giro degli ordini
   * fermi contro il pulsante del cliente, o un ritentativo di rete — passavano
   * tutti e due, e subito dopo `restore_stock_for_order` (una somma senza
   * guardia) e `wallet_credit` giravano due volte: su un ordine in contanti
   * pagato con 50 € di credito sono 50 € regalati, più pezzi di magazzino che
   * non esistono e che il negozio venderà.
   *
   * `.neq('delivery_status','CANCELED')` invece di un elenco di stati: chi
   * annulla resta chi annullava prima (il cliente solo da NEW, l'amministrazione
   * da qualunque stato non annullato) — quello che cambia è che a passare è
   * uno solo. Il secondo trova zero righe e se ne va senza toccare i soldi.
   */
  const { data: preso, error: updErr } = await admin
    .from('orders')
    .update({
      delivery_status: 'CANCELED',
      canceled_at: new Date().toISOString(),
      ...(order.payment_status === 'PENDING' ? { payment_status: 'FAILED' } : {}),
    })
    .eq('id', order.id)
    .neq('delivery_status', 'CANCELED')
    .select('id');
  if (updErr) return { ok: false, motivo: 'ANNULLAMENTO_FALLITO', dettaglio: updErr.message };
  if (!preso || preso.length === 0) return { ok: false, motivo: 'GIA_ANNULLATO' };

  await admin.rpc('restore_stock_for_order', { p_order_id: order.id });

  await restituisciCredito();
  await restituisciCoupon();

  return { ok: true, refundId: null };
}
