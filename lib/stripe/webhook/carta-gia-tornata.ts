import type Stripe from 'stripe';
import type { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from './comune';
import { scritturaObbligatoria } from './esito';

/**
 * 12/11/2026 (R03-008) — LA CARTA TORNATA PRIMA CHE L'ORDINE NASCA.
 *
 * Quando l'avviso «pagamento completato» fallisce, Stripe lo ripete per ore. Se nel frattempo
 * il cliente viene rimborsato (dal cruscotto, perché non vedeva l'ordine) o contesta il
 * pagamento con la banca, l'avviso del rimborso non trova ordini ed esce. Poi l'avviso del
 * pagamento passa e l'ordine nasceva «pagato», HELD: il negozio preparava, il giro dei bonifici
 * gli versava il netto, e la cliente aveva merce e soldi indietro. MyCity perdeva tutto.
 *
 * Adesso il gestore guarda la carta riletta da Stripe: se risulta rimborsata o contestata,
 * l'ordine nasce ANNULLATO, con il bonifico al negozio non pagabile (REFUNDED), senza
 * campanella né email al negozio, e chi amministra riceve un avviso con il carrello e le cifre.
 * L'ordine resta, così la traccia c'è e il controllo a mano parte da lì.
 */

export type CartaTornata = {
  /** Centesimi già restituiti sulla carta da FUORI (cruscotto), esclusi i rimborsi del sito. */
  rimborsatiCents: number;
  /** Il rimborso da fuori copre tutto il pagamento. */
  pieno: boolean;
  /** Contestata dal cliente con la banca. */
  contestata: boolean;
  /**
   * Collaudo K04 — cosa fare. «annulla»: contestazione, o rimborso da fuori che copre il
   * pagamento → gli ordini nascono annullati. «dividi»: rimborso da fuori parziale → gli ordini
   * nascono come sempre ma coi bonifici fermi, e chi amministra divide il rimborso fra i negozi
   * dal pannello (la stessa pausa del rimborso dal cruscotto su un carrello: rimborsi-da-fuori.ts).
   */
  azione: 'annulla' | 'dividi';
};

/**
 * La pausa dei bonifici che aspettano la divisione di un rimborso dal cruscotto. È la stessa di
 * lib/stripe/webhook/rimborsi-da-fuori.ts (PAUSA_RIMBORSO_DA_DIVIDERE): ripetuta qui per non
 * caricare tutto il modulo dei rimborsi nel gestore degli ordini; una prova le tiene uguali.
 */
export const PAUSA_DEL_RIMBORSO_DA_DIVIDERE = 'RIMBORSO_DA_RIPARTIRE';

type RimborsoLetto = { amount?: number | null; status?: string | null; metadata?: Record<string, string> | null };

/**
 * Un rimborso partito da FUORI: non del sito. I rimborsi del sito portano l'ordine
 * (`metadata.order_id`: refundOrder) o il carrello di questo tentativo (`pending_checkout_id`:
 * riserva scaduta, fascia persa, quadratura), o l'etichetta di un rimborso da fuori già scritto.
 */
function daFuori(r: RimborsoLetto, pendingCheckoutId: string): boolean {
  if (r.status === 'failed' || r.status === 'canceled') return false;
  const m = r.metadata ?? {};
  if ((m.order_id ?? '').trim()) return false;
  if ((m.registrato_da_fuori ?? '').trim()) return false;
  if ((m.pending_checkout_id ?? '').trim() === pendingCheckoutId) return false;
  return true;
}

/** La carta del pagamento è già tornata al cliente da fuori (rimborso o contestazione)? `null` se no. */
export function cartaGiaTornata(
  carica: string | Stripe.Charge | null | undefined,
  rimborsi: ReadonlyArray<RimborsoLetto>,
  pendingCheckoutId: string,
): CartaTornata | null {
  if (!carica || typeof carica === 'string') return null;
  const contestata = carica.disputed === true;
  const rimborsatiCents = rimborsi.filter((r) => daFuori(r, pendingCheckoutId)).reduce((s, r) => s + Math.max(0, Number(r.amount ?? 0)), 0);
  if (!contestata && rimborsatiCents <= 0) return null;
  const pagato = Math.max(0, Number(carica.amount_captured ?? carica.amount ?? 0));
  const pieno = rimborsatiCents > 0 && rimborsatiCents >= pagato;
  return { rimborsatiCents, pieno, contestata, azione: contestata || pieno ? 'annulla' : 'dividi' };
}

/**
 * 052 — Il pagamento si rilegge da Stripe per due cose: l'id della carica (`stripe_charge_id`,
 * senza il quale il bonifico al negozio parte senza `source_transaction` e resta bloccato) e,
 * dal 12/11, se la carta è già tornata al cliente. Una lettura caduta NON è un dettaglio:
 * l'evento si respinge e Stripe lo riconsegna (la creazione degli ordini è protetta
 * dall'indice unico su sessione e negozio).
 */
export async function leggiIlPagamento(
  stripe: Stripe,
  paymentIntent: string | null,
  sessionId: string,
  pendingCheckoutId: string,
): Promise<{ stripeChargeId: string | null; cartaTornata: CartaTornata | null }> {
  if (!paymentIntent) return { stripeChargeId: null, cartaTornata: null };
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ['latest_charge'] });
    const lc = pi.latest_charge as string | Stripe.Charge | null;
    const carica = lc && typeof lc !== 'string' ? lc : null;
    // I rimborsi si leggono solo se ce ne sono: per sapere chi li ha fatti.
    let rimborsi: RimborsoLetto[] = [];
    if (carica && Number(carica.amount_refunded ?? 0) > 0) {
      const elenco = await stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 });
      rimborsi = (elenco?.data ?? []) as RimborsoLetto[];
    }
    return {
      stripeChargeId: typeof lc === 'string' ? lc : (lc?.id ?? null),
      cartaTornata: cartaGiaTornata(carica, rimborsi, pendingCheckoutId),
    };
  } catch (e) {
    logger.error('[stripe] retrieve PI per charge_id fallita: evento respinto per riconsegna', {
      sessionId, paymentIntent, e,
    });
    throw e;
  }
}

/**
 * I campi dell'ordine che nasce su una carta già tornata. Annullato e mai da pagare al negozio;
 * oppure, per un rimborso parziale da fuori, come sempre ma col bonifico fermo da dividere.
 */
export function campiSeLaCartaETornata(carta: CartaTornata | null, totaleCents: number): Record<string, unknown> {
  if (!carta) return {};
  if (carta.azione === 'dividi') return { internal_dispute_status: PAUSA_DEL_RIMBORSO_DA_DIVIDERE };
  return {
    delivery_status: 'CANCELED',
    canceled_at: new Date().toISOString(),
    payout_status: 'REFUNDED',
    ...(carta.pieno ? { payment_status: 'REFUNDED', refunded_amount_cents: totaleCents } : {}),
  };
}

/** Rimborso parziale da fuori prima dell'ordine: gli ordini sono nati coi bonifici fermi. */
export async function avvisaDelRimborsoDaDividere(
  admin: ReturnType<typeof getAdminSupabase>,
  pendingCheckoutId: string,
  ordini: ReadonlyArray<{ orderId: string }>,
  carta: CartaTornata,
): Promise<void> {
  // Anche gli ordini nati in un tentativo di prima si fermano (quelli nuovi nascono già fermi).
  const { error } = await admin
    .from('orders')
    .update({ internal_dispute_status: PAUSA_DEL_RIMBORSO_DA_DIVIDERE })
    .in('id', ordini.map((o) => o.orderId))
    .is('internal_dispute_status', null);
  if (error) throw new Error(`bonifici del carrello ${pendingCheckoutId} non fermati per il rimborso da dividere: ${error.message}`);
  try {
    await notifyAdmins(
      '⚠️ Rimborso dal cruscotto da dividere',
      `Sul pagamento del carrello ${pendingCheckoutId} erano già usciti ${formatPriceFromCents(carta.rimborsatiCents)} di rimborso ` +
        "dal cruscotto quando è arrivato l'avviso del pagamento. Gli ordini sono nati con i bonifici fermi: dividi il rimborso fra i negozi dal pannello.",
      '/admin/orders',
      { unaVoltaPer: `carta-tornata-da-dividere:${pendingCheckoutId}` },
    );
  } catch (e) {
    logger.error('[stripe] avviso del rimborso da dividere non partito', { pendingCheckoutId, e });
  }
}

/**
 * Gli ordini sono nati annullati: si avvisa chi amministra e il carrello si chiude. Niente
 * campanella né email al negozio (non c'è niente da preparare), niente conferma al cliente.
 */
export async function chiudiIlCarrelloDellaCartaTornata(
  admin: ReturnType<typeof getAdminSupabase>,
  pendingCheckoutId: string,
  paymentIntent: string | null,
  ordini: ReadonlyArray<{ orderId: string; totalCents: number }>,
  carta: CartaTornata,
): Promise<void> {
  // Collaudo del 12/11 — gli ordini nati in un tentativo di prima (prima che la carta tornasse)
  // sono ancora PAID/HELD: si allineano anche loro, se il loro bonifico non è partito.
  const { error: errAllinea } = await admin
    .from('orders')
    .update({ delivery_status: 'CANCELED', canceled_at: new Date().toISOString(), payout_status: 'REFUNDED', ...(carta.pieno ? { payment_status: 'REFUNDED' } : {}) })
    .in('id', ordini.map((o) => o.orderId))
    .eq('payout_status', 'HELD');
  // Se l'allineamento cade il carrello NON si chiude: Stripe riconsegna e si riprova (collaudo K04).
  if (errAllinea) {
    logger.error('[stripe] ordini di un tentativo precedente non allineati alla carta tornata', { pendingCheckoutId, message: errAllinea.message });
    throw new Error(`ordini del carrello ${pendingCheckoutId} non allineati alla carta tornata: ${errAllinea.message}`);
  }
  const totale = ordini.reduce((s, o) => s + o.totalCents, 0);
  const come = carta.contestata
    ? 'contestato dal cliente con la banca'
    : carta.pieno ? 'già rimborsato per intero' : `già rimborsato per ${formatPriceFromCents(carta.rimborsatiCents)}`;
  logger.error('[stripe] pagamento gia tornato al cliente prima dell ordine: ordini nati annullati', {
    pendingCheckoutId, paymentIntent, ordini: ordini.map((o) => o.orderId), carta,
  });
  await notifyAdmins(
    '⚠️ Pagamento tornato al cliente prima dell ordine',
    `Il pagamento del carrello ${pendingCheckoutId} (${formatPriceFromCents(totale)}) era ${come} quando è arrivato l'avviso ` +
      `del pagamento. ${ordini.length === 1 ? "L'ordine è nato annullato" : `Gli ${ordini.length} ordini sono nati annullati`} ` +
      `(${ordini.map((o) => '#' + o.orderId.slice(0, 8)).join(', ')}), senza bonifico al negozio e senza avvisi al negozio. ` +
      'Controlla su Stripe e, se serve, rimetti a scaffale la merce.',
    '/admin/orders',
    { unaVoltaPer: `carta-tornata:${pendingCheckoutId}` },
  );
  scritturaObbligatoria(await admin
    .from('pending_checkouts')
    .update({ status: 'COMPLETED', stripe_payment_intent: paymentIntent, processed_at: new Date().toISOString() })
    .eq('id', pendingCheckoutId), 'carrello della carta tornata segnato come completato');
}
