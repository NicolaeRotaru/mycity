import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from './comune';
import { paymentIntentDi } from './contestazione-buoni';

/**
 * 28/11/2026 (onda 2, R05-010 / R05-011) — UNA CONTESTAZIONE SENZA ORDINI NON È PER FORZA UN BUONO REGALO.
 *
 * Senza ordini col pagamento contestato, `handleDisputeCreated` pensava a un buono regalo o a una
 * sponsorizzazione: segnava il pagamento come contestato per i buoni (`gift_card_void_for_payment`, che se
 * non trova il buono se lo annota), cercava la sponsorizzazione e poi usciva con una riga nel registro. Ma il
 * pagamento può essere quello di un carrello del marketplace il cui ordine non è ancora nato (l'avviso del
 * pagamento non è passato, o è a metà): la contestazione si perdeva in silenzio, l'ordine nasceva dopo
 * senza `dispute_status` e il negozio veniva pagato con soldi che la banca si era già ripresa.
 *
 * Adesso, prima dei buoni, si guarda di quale carrello è il pagamento (`pending_checkout_id` nei metadati
 * del pagamento, o il gruppo `mc_<carrello>`, lib/stripe/client.ts), come fa il rimborso (rimborsi.ts):
 *  · carrello PENDING: l'ordine può nascere fra un attimo → si lancia, Stripe ripete e al giro dopo trova
 *    l'ordine (o il carrello chiuso);
 *  · carrello COMPLETED ma nessun ordine letto: sono nati fra la lettura degli ordini e questa → si lancia;
 *  · carrello scaduto o annullato (l'ordine non nascerà): non è un buono né una sponsorizzazione. Lo si
 *    dice agli amministratori, una volta, con l'importo: il pagamento di un carrello mai diventato ordine
 *    di solito è già rimborsato, e con la contestazione si può perdere due volte;
 *  · nessun carrello: buono regalo o sponsorizzazione, come prima.
 *
 * Un errore nel leggere il pagamento su Stripe o il carrello si rilancia: Stripe ripete l'evento.
 * Ritorna true se la contestazione è sistemata qui (chi chiama esce), false se non è di un carrello.
 */
export async function laContestazioneDiUnCarrelloSenzaOrdini(
  dispute: Stripe.Dispute,
  quando: 'apertura' | 'chiusura',
): Promise<boolean> {
  const carrello = await carrelloDelPagamento(dispute);
  if (!carrello) return false;
  const { data, error } = await getAdminSupabase().from('pending_checkouts').select('status').eq('id', carrello).maybeSingle();
  if (error) throw new Error(`[stripe] carrello della contestazione non letto (${carrello}): ${error.message}`);
  const stato = (data as { status?: string } | null)?.status ?? null;
  if (stato === 'PENDING' || stato === 'COMPLETED') {
    logger.error('[stripe] contestazione su un carrello il cui ordine non è (ancora) letto: si riprova', {
      disputeId: dispute.id, carrello, stato, quando,
    });
    throw new Error(`[stripe] contestazione ${dispute.id} sul carrello ${carrello} (${stato}) senza ordini: l'ordine può ancora nascere, si riprova`);
  }
  logger.error('[stripe] contestazione su un carrello mai diventato ordine', { disputeId: dispute.id, carrello, stato, quando });
  await notifyAdmins(
    quando === 'apertura' ? '⚠️ Contestazione su un pagamento senza ordine' : 'ℹ️ Chiusa la contestazione su un pagamento senza ordine',
    quando === 'apertura'
      ? `La banca contesta ${formatPriceFromCents(dispute.amount ?? 0)} (contestazione ${dispute.id}) su un pagamento il cui carrello ` +
        `non è mai diventato ordine (${stato ?? 'carrello non trovato'}). Controlla su Stripe se quel pagamento è già stato rimborsato: ` +
        'se sì, rispondi alla banca col rimborso, o i soldi escono due volte.'
      : `La contestazione ${dispute.id} (${formatPriceFromCents(dispute.amount ?? 0)}) su un pagamento senza ordine è chiusa: ${dispute.status}.`,
    '/admin/disputes',
    { unaVoltaPer: `contestazione-senza-ordine:${dispute.id}:${quando}` },
  );
  return true;
}

/** Il carrello del marketplace del pagamento contestato, o null (buono regalo, sponsorizzazione, altro). */
async function carrelloDelPagamento(dispute: Stripe.Dispute): Promise<string | null> {
  const daQui = (o: unknown): string | null => {
    if (!o || typeof o !== 'object') return null;
    const { metadata, transfer_group: gruppo } = o as { metadata?: Record<string, string> | null; transfer_group?: string | null };
    const id = metadata?.pending_checkout_id?.trim();
    if (id) return id;
    return typeof gruppo === 'string' && gruppo.startsWith('mc_') && gruppo.length > 3 ? gruppo.slice(3) : null;
  };
  // Espansi nell'evento (di solito no: sono identificativi).
  const espanso = daQui(dispute.charge) ?? daQui(dispute.payment_intent);
  if (espanso) return espanso;
  const pi = paymentIntentDi(dispute);
  if (pi) return daQui(await getStripe().paymentIntents.retrieve(pi));
  const charge = typeof dispute.charge === 'string' ? dispute.charge : null;
  if (charge) return daQui(await getStripe().charges.retrieve(charge));
  return null;
}
