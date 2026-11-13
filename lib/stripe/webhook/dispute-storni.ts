/**
 * Lo storno della contestazione già fatto su Stripe (R81, R23-012).
 *
 * R23-012 — Stava in `dispute.ts`, che era arrivato al tetto di righe della prova di struttura
 * (tests/unit/webhook-diviso-per-mestiere.test.ts): spostato qui, uguale.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';
import { formatPriceFromCents } from '@/lib/format';

/** Uno storno al negozio che va guardato a mano, per l'avviso agli amministratori. */
export type StornoDaControllare = { orderId: string; testo: string };

/**
 * 15/10/2026 (R81) — Su Stripe c'è già uno storno di questo bonifico fatto da
 * quando la contestazione è nata? Si chiede a Stripe e non al database, perché
 * il database può non averlo registrato (un processo morto fra la risposta di
 * Stripe e la scrittura). Se Stripe non risponde si lancia: la rotta risponde
 * 500 e Stripe riprova (prima di questo punto è stata scritta solo la riga OPEN).
 *
 * R23-012 — «Nato dopo la contestazione» non basta: durante una richiesta di informazioni il
 * pagamento si può ancora rimborsare, e lo storno del rimborso porta lo stesso order_id. Preso
 * per quello della contestazione, la fetta del negozio non si toglieva mai. Conta solo lo storno
 * di QUESTA contestazione: col suo id nei metadati, se lo porta; se no (gli storni di
 * `reverseOrderTransfer` portano solo l'ordine) con l'importo uguale alla quota da riprendere.
 */
export async function stornoGiaFattoPerLaContestazione(
  o: { id: string; stripe_transfer_id: string | null; stripe_reversal_id: string | null },
  dispute: Stripe.Dispute,
  quota: number,
  daControllare: StornoDaControllare[],
): Promise<boolean> {
  if (!o.stripe_transfer_id) return false;
  const dal = dispute.created ?? 0;
  const storni = await getStripe().transfers.listReversals(o.stripe_transfer_id, { limit: 100 });
  const suo = storni.data.find((r) => r.created >= dal && (r.metadata?.order_id ?? o.id) === o.id
    && (r.metadata?.dispute_id ? r.metadata.dispute_id === dispute.id : r.amount === quota));
  if (suo && suo.id !== o.stripe_reversal_id) {
    // Fatto su Stripe, non scritto da noi: non si rifà, ma va visto. Non solo
    // nei log: senza registrazione, a contestazione vinta il negozio non
    // verrebbe ripagato (per il database il bonifico non è mai stato toccato).
    logger.error('[stripe] storno della contestazione fatto su Stripe ma non registrato sull ordine', {
      orderId: o.id, reversalId: suo.id, centesimi: suo.amount,
    });
    daControllare.push({
      orderId: o.id,
      testo: `ordine ${o.id.slice(0, 8)}: lo storno di ${formatPriceFromCents(suo.amount)} (${suo.id}) è su Stripe ma non sull'ordine. Non va rifatto: va solo registrato sull'ordine.`,
    });
  }
  return !!suo;
}
