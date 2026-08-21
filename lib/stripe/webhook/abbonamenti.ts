/**
 * Abbonamento del venditore: attivazione, cambi di stato, fattura non pagata.
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
import { getStripe } from '@/lib/stripe/client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/** Mappa lo stato Stripe della subscription sul nostro enum profili. */
export function mapSubscriptionStatus(status: Stripe.Subscription.Status): 'active' | 'past_due' | 'canceled' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    default: // canceled, incomplete_expired
      return 'canceled';
  }
}

/**
 * Checkout abbonamento venditore riuscito (mode=subscription). Salva i
 * riferimenti Stripe Customer/Subscription sul profilo e attiva l'abbonamento.
 * Idempotente: una re-delivery riscrive gli stessi valori.
 */
export async function handleSellerSubscription(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const sellerId = session.metadata?.seller_id || null;
  const customerId = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription?.id ?? null);

  if (!sellerId || !subscriptionId) {
    logger.error('[stripe] seller_subscription metadata incompleti', { sessionId: session.id });
    throw new Error(`abbonamento con dati incompleti (sessione ${session.id})`);
  }

  // Recupera periodo di rinnovo (best-effort).
  let renewsAt: string | null = null;
  try {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId);
    if (sub.current_period_end) renewsAt = new Date(sub.current_period_end * 1000).toISOString();
  } catch (e) {
    logger.warn('[stripe] retrieve subscription per renews_at fallita', e);
  }

  await admin
    .from('profiles')
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: 'active',
      subscription_renews_at: renewsAt,
    })
    .eq('id', sellerId);

  await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
    user_id: sellerId,
    title: '✅ Abbonamento attivo',
    body: 'Il tuo abbonamento venditore (€50/mese) è attivo. Grazie!',
    link: '/seller/dashboard',
  });
}

/**
 * customer.subscription.updated / .deleted → sincronizza subscription_status e
 * subscription_renews_at sul profilo del venditore (lookup per subscription id).
 */
export async function handleSubscriptionChanged(sub: Stripe.Subscription) {
  const admin = getAdminSupabase();
  const status = mapSubscriptionStatus(sub.status);
  const renewsAt = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  await admin
    .from('profiles')
    .update({ subscription_status: status, subscription_renews_at: renewsAt })
    .eq('stripe_subscription_id', sub.id);
}

/**
 * invoice.payment_failed → la carta del venditore è stata rifiutata: marca
 * l'abbonamento past_due (lookup per customer id) e avvisa il venditore.
 */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null);
  if (!customerId) return;
  const admin = getAdminSupabase();
  const { data: rows } = await admin
    .from('profiles')
    .update({ subscription_status: 'past_due' })
    .eq('stripe_customer_id', customerId)
    .select('id');
  for (const r of rows ?? []) {
    await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
      user_id: r.id,
      title: '⚠️ Pagamento abbonamento non riuscito',
      body: 'Non siamo riusciti ad addebitare l’abbonamento mensile. Aggiorna il metodo di pagamento.',
      link: '/seller/dashboard',
    });
  }
}
