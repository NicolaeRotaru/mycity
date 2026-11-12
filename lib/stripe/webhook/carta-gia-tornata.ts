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
  /** Centesimi già restituiti sulla carta. */
  rimborsatiCents: number;
  /** Tutto restituito. */
  pieno: boolean;
  /** Contestata dal cliente con la banca. */
  contestata: boolean;
};

/** La carta del pagamento è già tornata al cliente (rimborso o contestazione)? `null` se no. */
export function cartaGiaTornata(carica: string | Stripe.Charge | null | undefined): CartaTornata | null {
  if (!carica || typeof carica === 'string') return null;
  const rimborsatiCents = Math.max(0, Number(carica.amount_refunded ?? 0));
  const contestata = carica.disputed === true;
  if (rimborsatiCents <= 0 && carica.refunded !== true && !contestata) return null;
  return { rimborsatiCents, pieno: carica.refunded === true, contestata };
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
): Promise<{ stripeChargeId: string | null; cartaTornata: CartaTornata | null }> {
  if (!paymentIntent) return { stripeChargeId: null, cartaTornata: null };
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ['latest_charge'] });
    const lc = pi.latest_charge;
    return {
      stripeChargeId: typeof lc === 'string' ? lc : (lc?.id ?? null),
      cartaTornata: cartaGiaTornata(lc as string | Stripe.Charge | null),
    };
  } catch (e) {
    logger.error('[stripe] retrieve PI per charge_id fallita: evento respinto per riconsegna', {
      sessionId, paymentIntent, e,
    });
    throw e;
  }
}

/** I campi dell'ordine che nasce su una carta già tornata: annullato, mai da pagare al negozio. */
export function campiSeLaCartaETornata(carta: CartaTornata | null, totaleCents: number): Record<string, unknown> {
  if (!carta) return {};
  return {
    delivery_status: 'CANCELED',
    canceled_at: new Date().toISOString(),
    payout_status: 'REFUNDED',
    ...(carta.pieno ? { payment_status: 'REFUNDED', refunded_amount_cents: totaleCents } : {}),
  };
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
