/**
 * Pezzi condivisi dai gestori del webhook Stripe: chi sono gli admin,
 * quali ordini tocca una contestazione, e se una sessione è davvero pagata.
 *
 * #12 — Perché sta qui e non in `app/api/stripe/webhook/route.ts`.
 *
 * Quel file era uno solo, da mille righe, con dentro otto mestieri senza
 * rapporto fra loro: creazione ordini, buoni regalo, spazi sponsorizzati,
 * abbonamenti, rimborsi, contestazioni, storni, esiti dei pagamenti. Ogni
 * modifica ai buoni regalo si portava dietro il rischio di toccare la
 * creazione degli ordini, perché stavano nello stesso file e la revisione
 * mostrava un diff dentro un blocco da mille righe. È la strada su cui
 * passano tutti i soldi del marketplace: è l'ultimo posto dove si vuole una
 * revisione difficile da leggere.
 *
 * Nessuna logica è cambiata in questo spostamento: le prove esistenti sul
 * webhook sono la dimostrazione che non si è rotto niente.
 */
import type Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/server';

export type DisputeOrderRow = {
  id: string;
  payout_status: string | null;
  stripe_transfer_id: string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents?: number | null;
  rider_payout_reversed_cents?: number | null;
  delivery_status?: string | null;
  stripe_reversal_id: string | null;
  // Servono per recuperare anche il compenso versato al fattorino.
  rider_id?: string | null;
  rider_transfer_id: string | null;
  rider_payout_status: string | null;
  rider_fee_cents?: number | null;
  shipping_cost?: number | string | null;
};

/** Trova gli ordini legati alla charge/PI di una dispute (multi-seller). */
export async function findOrdersForDispute(dispute: Stripe.Dispute, columns: string): Promise<DisputeOrderRow[]> {
  const admin = getAdminSupabase();
  const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge?.id ?? null);
  if (pi) {
    const { data } = await admin.from('orders').select(columns).eq('stripe_payment_intent', pi);
    if (data && data.length > 0) return data as unknown as DisputeOrderRow[];
  }
  if (chargeId) {
    const { data } = await admin.from('orders').select(columns).eq('stripe_charge_id', chargeId);
    if (data && data.length > 0) return data as unknown as DisputeOrderRow[];
  }
  return [];
}

/**
 * 057 — Una sessione «completata» non è per forza una sessione PAGATA. Stripe
 * usa `payment_status`: 'paid' o 'no_payment_required' vogliono dire soldi
 * arrivati (o non dovuti); 'unpaid' vuol dire che il pagamento è ancora per
 * strada, come succede con bonifici e pagamenti differiti.
 */
export function sessionePagata(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
}

/** Inserisce una notifica per tutti gli admin. */
export async function notifyAdmins(title: string, body: string, link: string) {
  const admin = getAdminSupabase();
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
  if (!admins || admins.length === 0) return;
  await admin.from('notifications').insert(admins.map((a) => ({ user_id: a.id, title, body, link })));
}
