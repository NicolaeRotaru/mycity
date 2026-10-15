/**
 * Un rimborso PARZIALE fatto a mano dal cruscotto Stripe, cioè non partito da
 * `refundOrder`.
 *
 * 15/10/2026 (R85) — IL RIMBORSO DAL CRUSCOTTO VENIVA IGNORATO.
 *
 * Quando arrivava `charge.refunded` con un rimborso non totale, il gestore
 * scriveva un avviso nei log («riconciliare a mano») e usciva. Lo faceva anche
 * quando il pagamento apparteneva a un ordine solo, dove non c'è nessun dubbio
 * su chi abbia rimborsato cosa. Un caso vero: ordine da Pane Quotidiano di
 * 27,90 €, manca una focaccia da 3 €, Nicola rimborsa 3 € dal cruscotto. Sul
 * nostro database l'ordine restava «pagato», con zero rimborsato. Due danni:
 *
 *   ① il giro dei bonifici versava al negozio il netto intero (18,00 €): la sua
 *     parte dei 3 € la pagava MyCity;
 *   ② l'annullo successivo chiedeva a Stripe 27,90 € quando ne restavano 24,90:
 *     Stripe rifiutava e l'ordine non si poteva più annullare dal sito.
 *
 * Adesso, su un ordine solo, il rimborso si registra con la stessa contabilità
 * di `refundOrder` — importo rimborsato, quota del negozio, stato «rimborsato
 * in parte» — senza chiedere a Stripe un secondo rimborso: quello è già
 * uscito. Su un pagamento di più negozi Stripe non dice a quale ordine
 * appartiene il rimborso, e indovinare vorrebbe dire togliere soldi al negozio
 * sbagliato: lì si fermano i bonifici del carrello e si avvisano gli
 * amministratori.
 *
 * COME SI RICONOSCE UN RIMBORSO GIÀ REGISTRATO. Non dall'etichetta del
 * rimborso, ma dai numeri: `refundOrder` scrive l'importo sull'ordine
 * (`accumula_rimborso`) PRIMA di chiedere il rimborso a Stripe. Quindi, quando
 * Stripe ci avvisa, il rimborsato su Stripe meno il rimborsato scritto da noi
 * è esattamente la parte che nessuno ha ancora registrato. L'eco di un nostro
 * rimborso dà zero e non tocca niente; lo stesso evento consegnato due volte
 * dà zero la seconda volta.
 */
import type Stripe from 'stripe';
import { reverseOrderTransfer } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { notifyAdmins } from './comune';
import { scritturaObbligatoria } from './esito';

/** I campi dell'ordine che servono a registrare il rimborso. */
export type OrdineDelRimborso = {
  id: string;
  /** Sulla carta è il lordo pagato: non c'è credito MyCity da scomputare (ordini.ts). */
  total_price: number | string | null;
  refunded_amount_cents?: number | null;
  payout_status: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id?: string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents?: number | null;
};

/**
 * Valore di `internal_dispute_status` che ferma il giro dei bonifici: il giro
 * paga solo gli ordini con quel campo vuoto o 'RESOLVED'. Si toglie scrivendo
 * 'RESOLVED' quando il rimborso è stato diviso a mano fra i negozi.
 */
export const PAUSA_RIMBORSO_DA_DIVIDERE = 'RIMBORSO_DA_RIPARTIRE';

export type ContoRimborsoDaFuori = {
  /** Il lordo dell'ordine: il tetto di quanto si può rimborsare. */
  lordoCents: number;
  /** Quanto risultava già rimborsato sul nostro database. */
  giaRegistratoCents: number;
  /** La parte del rimborso che nessuno ha ancora registrato. */
  nuovoCents: number;
  /** Il rimborsato dopo questa registrazione. */
  totaleCents: number;
  /** La parte del nuovo rimborso che esce dalla quota del negozio. */
  quotaNegozioCents: number;
};

/**
 * Il conto, senza toccare niente: quanto del rimborso fatto su Stripe manca sul
 * nostro ordine, e quanto ne paga il negozio.
 *
 * La quota del negozio è la stessa di `refundOrder`: la piattaforma restituisce
 * la sua commissione, e al negozio si toglie solo la sua parte del netto, in
 * proporzione al rimborso (rimborso × netto del negozio ÷ lordo dell'ordine).
 */
export function contoDelRimborsoDaFuori(
  ordine: Pick<OrdineDelRimborso, 'total_price' | 'refunded_amount_cents' | 'seller_payout_cents'>,
  rimborsatoSuStripeCents: number,
): ContoRimborsoDaFuori {
  const lordoCents = Math.round(Number(ordine.total_price ?? 0) * 100);
  const giaRegistratoCents = ordine.refunded_amount_cents ?? 0;
  const tetto = Math.min(Math.max(0, rimborsatoSuStripeCents), Math.max(0, lordoCents));
  const nuovoCents = Math.max(0, tetto - giaRegistratoCents);
  const netto = ordine.seller_payout_cents ?? 0;
  const quotaNegozioCents =
    lordoCents > 0 ? Math.min(Math.round((nuovoCents * netto) / lordoCents), netto) : 0;
  return {
    lordoCents,
    giaRegistratoCents,
    nuovoCents,
    totaleCents: giaRegistratoCents + nuovoCents,
    quotaNegozioCents,
  };
}

/**
 * Registra sul nostro database un rimborso parziale arrivato da fuori.
 * Lancia se il database non risponde, così la rotta risponde 500 e Stripe
 * ripete l'evento: la seconda volta il conto riparte dai numeri scritti, e quello
 * che era già stato registrato non si registra due volte.
 */
export async function registraRimborsoParzialeDaFuori(
  charge: Stripe.Charge,
  ordini: OrdineDelRimborso[],
): Promise<void> {
  const rimborsatoSuStripe = charge.amount_refunded ?? 0;
  if (ordini.length === 0) return;
  if (ordini.length > 1) {
    await fermaIBonificiDelCarrello(charge, ordini, rimborsatoSuStripe);
    return;
  }

  const ordine = ordini[0];
  const conto = contoDelRimborsoDaFuori(ordine, rimborsatoSuStripe);
  // Zero: è l'eco di un rimborso nostro, o lo stesso avviso arrivato di nuovo.
  if (conto.nuovoCents <= 0) return;

  // Il giro dei bonifici ha preso in mano questo ordine e sta pagando: il conto
  // si fa quando ha finito, altrimenti il bonifico parte col netto intero e la
  // quota tolta qui resterebbe solo sulla carta. Stripe riprova più tardi.
  if (ordine.payout_status === 'PROCESSING') {
    throw new Error(`[stripe] rimborso da fuori sull'ordine ${ordine.id}: bonifico in corso, si riprova dopo`);
  }

  const bonificoUscito = ordine.payout_status === 'TRANSFERRED' && !!ordine.stripe_transfer_id;
  const valori: Record<string, unknown> = {
    refunded_amount_cents: conto.totaleCents,
    payment_status: 'PARTIALLY_REFUNDED',
  };
  if (!bonificoUscito) {
    // Bonifico non ancora partito: la quota del negozio si toglie da quello che
    // gli verrà versato (stesso campo e stesso tetto di `refundOrder`).
    const netto = ordine.seller_payout_cents ?? 0;
    valori.seller_payout_reversed_cents = Math.min(
      (ordine.seller_payout_reversed_cents ?? 0) + conto.quotaNegozioCents,
      netto,
    );
  }

  // La scrittura passa solo se nessuno ha cambiato l'ordine da quando l'ho
  // letto: né un altro rimborso (stesso importo rimborsato), né il giro dei
  // bonifici (stesso stato del bonifico). Se qualcuno l'ha cambiato, Stripe
  // riprova e il conto si rifà sui numeri nuovi, invece di sommare due volte.
  let scrittura = getAdminSupabase()
    .from('orders')
    .update(valori)
    .eq('id', ordine.id)
    .eq('refunded_amount_cents', conto.giaRegistratoCents);
  scrittura = ordine.payout_status === null
    ? scrittura.is('payout_status', null)
    : scrittura.eq('payout_status', ordine.payout_status);
  const { data: registrati } = scritturaObbligatoria(
    await scrittura.select('id'),
    'rimborso parziale dal cruscotto registrato sull ordine',
  );
  if (!registrati || registrati.length === 0) {
    throw new Error(`[stripe] rimborso da fuori sull'ordine ${ordine.id}: l'ordine è cambiato nel frattempo, si riprova`);
  }

  logger.info('[stripe] rimborso parziale dal cruscotto registrato sull ordine', {
    orderId: ordine.id, chargeId: charge.id, nuovoCents: conto.nuovoCents, quotaNegozioCents: conto.quotaNegozioCents,
  });

  if (!bonificoUscito || conto.quotaNegozioCents <= 0) return;

  // Bonifico già uscito: la quota del negozio si riprende con uno storno. Il
  // rimborso è già registrato qui sopra, quindi se lo storno non riesce non si
  // ritenta da solo: diventa un lavoro dichiarato agli amministratori, come in
  // `refundOrder`.
  try {
    await reverseOrderTransfer(ordine, conto.quotaNegozioCents);
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'errore sconosciuto';
    logger.error('[stripe] quota del negozio non ripresa dopo il rimborso dal cruscotto', {
      orderId: ordine.id, centesimi: conto.quotaNegozioCents, err,
    });
    // Un promemoria in una scrittura sua: se il vincolo del database non
    // conosce ancora questo stato (migrazione 130), cade solo il promemoria.
    const { error: errSegno } = await getAdminSupabase()
      .from('orders')
      .update({ payout_status: 'REVERSAL_FAILED', reversal_error: motivo.slice(0, 500) })
      .eq('id', ordine.id);
    if (errSegno) {
      logger.error('[stripe] storno mancato non segnato sull ordine', { orderId: ordine.id, message: errSegno.message });
    }
    await notifyAdmins(
      '⚠️ Storno al venditore non riuscito',
      `Dal cruscotto Stripe è uscito un rimborso di €${(conto.nuovoCents / 100).toFixed(2)} sull'ordine ${ordine.id}, ` +
        `ma i €${(conto.quotaNegozioCents / 100).toFixed(2)} di quota del negozio non sono rientrati (${motivo}). Vanno recuperati a mano.`,
      '/admin/orders',
    );
  }
}

/**
 * Pagamento di più negozi: Stripe non dice a quale ordine appartiene il
 * rimborso. Si fermano i bonifici del carrello non ancora pagati e si
 * avvisano gli amministratori, che dividono il rimborso a mano.
 */
async function fermaIBonificiDelCarrello(
  charge: Stripe.Charge,
  ordini: OrdineDelRimborso[],
  rimborsatoSuStripe: number,
): Promise<void> {
  const registrato = ordini.reduce((somma, o) => somma + (o.refunded_amount_cents ?? 0), 0);
  const daDividere = rimborsatoSuStripe - registrato;
  // Zero o meno: è l'eco dei nostri rimborsi, ognuno già scritto sul suo ordine.
  if (daDividere <= 0) return;

  const ids = ordini.map((o) => o.id);
  // Solo chi oggi è pagabile: un reclamo interno già aperto resta com'è.
  scritturaObbligatoria(
    await getAdminSupabase()
      .from('orders')
      .update({ internal_dispute_status: PAUSA_RIMBORSO_DA_DIVIDERE })
      .in('id', ids)
      .or('internal_dispute_status.is.null,internal_dispute_status.eq.RESOLVED'),
    'bonifici del carrello fermati per un rimborso da dividere',
  );

  const giaPagati = ordini.filter((o) => o.payout_status === 'TRANSFERRED').map((o) => o.id);
  logger.warn('[stripe] rimborso parziale dal cruscotto su un pagamento di più negozi: bonifici fermati', {
    chargeId: charge.id, daDividere, ordini: ids,
  });
  await notifyAdmins(
    '⚠️ Rimborso dal cruscotto da dividere fra i negozi',
    `Dal cruscotto Stripe è uscito un rimborso di €${(daDividere / 100).toFixed(2)} su un pagamento che copre ${ordini.length} ordini ` +
      `(${ids.map((i) => i.slice(0, 8)).join(', ')}). Stripe non dice a quale negozio appartiene: i bonifici di questi ordini sono fermi ` +
      'finché il rimborso non viene diviso a mano.' +
      (giaPagati.length > 0
        ? ` ${giaPagati.length} ordine/i erano già stati pagati al negozio: la quota va ripresa a mano.`
        : ''),
    '/admin/orders',
  );
}
