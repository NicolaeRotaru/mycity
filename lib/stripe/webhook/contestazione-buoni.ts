import type Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from './comune';
import { eUnaRichiestaDiInformazioni } from './quanto-restituire';

/**
 * R11-022 — SUI BUONI REGALO LA CONTESTAZIONE ANDAVA IN UNA SOLA DIREZIONE.
 *
 * All'apertura, senza ordini, si annullava subito il buono comprato con quel
 * pagamento (`gift_card_void_for_payment`, 178) anche quando era solo una
 * richiesta di informazioni della banca, che a MyCity non toglie niente. E alla
 * chiusura, senza ordini, il gestore usciva subito: ne' la vittoria ne' la fine
 * della richiesta restituivano il buono, e il vincolo della 178 impedisce di
 * riattivarlo da solo.
 *
 * Adesso: una richiesta di informazioni non annulla il buono (si avvisa e
 * basta); una contestazione vinta su un buono annullato per contestazione lo
 * dice agli amministratori, con codice e importo, perche' lo riattivino. La
 * riattivazione automatica (una funzione del database) va scritta col «Per
 * riaccendere» di BUONI_REGALO_IN_VENDITA, oggi spento.
 */
export function paymentIntentDi(dispute: Stripe.Dispute): string | null {
  return typeof dispute.payment_intent === 'string' ? dispute.payment_intent : (dispute.payment_intent?.id ?? null);
}

/** All'apertura senza ordini: true se e' solo una richiesta di informazioni (il buono resta acceso). */
export async function richiestaSulBuonoSoloAvviso(dispute: Stripe.Dispute): Promise<boolean> {
  if (!eUnaRichiestaDiInformazioni(dispute)) return false;
  await notifyAdmins(
    'ℹ️ La banca chiede informazioni su un pagamento',
    `Richiesta di informazioni ${dispute.id} su un pagamento senza ordini (forse un buono regalo) — ${formatPriceFromCents(dispute.amount ?? 0)}. Nessun soldo tolto: il buono resta valido.`,
    '/admin/disputes',
  );
  return true;
}

/** Alla chiusura vinta senza ordini: se il buono era stato annullato per la contestazione, lo si dice. */
export async function buonoDaRiattivareDopoLaVittoria(dispute: Stripe.Dispute): Promise<void> {
  if (dispute.status !== 'won') return;
  const pi = paymentIntentDi(dispute);
  if (!pi) return;
  const { data, error } = await getAdminSupabase()
    .from('gift_cards')
    .select('code, voided_cents, void_reason, voided_at')
    .eq('stripe_payment_intent', pi)
    .maybeSingle();
  if (error) {
    logger.error('[stripe] contestazione vinta: buono regalo non leggibile', { disputeId: dispute.id, message: error.message });
    return;
  }
  const buono = data as { code?: string; voided_cents?: number | null; void_reason?: string | null; voided_at?: string | null } | null;
  if (!buono?.voided_at || buono.void_reason !== 'disputed') return;
  await notifyAdmins(
    '⚠️ Contestazione vinta: buono regalo da riattivare',
    `La contestazione ${dispute.id} è vinta, ma il buono ${buono.code} era stato annullato all'apertura (${formatPriceFromCents(buono.voided_cents ?? 0)} tolti fra saldo e credito). Va riattivato a mano.`,
    '/admin/disputes',
  );
}
