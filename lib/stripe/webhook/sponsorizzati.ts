/**
 * Spazi sponsorizzati comprati dai venditori.
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
import { logger } from '@/lib/logger';

/**
 * Pagamento sponsorizzazione riuscito → crea la `sponsored_listing` attiva
 * (server-side, service role). Idempotente sullo stripe_session_id.
 */
export async function handleSponsoredPurchase(session: Stripe.Checkout.Session) {
  const admin = getAdminSupabase();
  const m = session.metadata ?? {};
  const sellerId = m.seller_id || null;
  const productId = m.product_id || null;
  const days = parseInt(m.days ?? '0', 10);
  const placement = m.placement || 'search_top';
  const amountCents = parseInt(m.amount_cents ?? '0', 10);

  if (!sellerId || !productId || !Number.isFinite(days) || days <= 0) {
    logger.error('[stripe] sponsored metadata incompleti', { sessionId: session.id });
    throw new Error(`sponsorizzazione con dati incompleti (sessione ${session.id})`);
  }

  const today = new Date();
  const end = new Date(today.getTime() + days * 86_400_000);
  const startStr = today.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const perDay = days > 0 ? Math.round(amountCents / days) : amountCents;

  const { error } = await admin.from('sponsored_listings').insert({
    product_id: productId,
    seller_id: sellerId,
    placement,
    category_slug: null,
    start_date: startStr,
    end_date: endStr,
    daily_budget_cents: perDay,
    spent_cents: amountCents,
    status: 'active',
    stripe_session_id: session.id,
  });

  if (error) {
    if (error.code === '23505') {
      logger.info('[stripe] sponsored già creata per questa sessione, skip', { sessionId: session.id });
      return;
    }
    logger.error(error, { context: 'stripe-sponsored-insert', sessionId: session.id });
    throw new Error(`sponsorizzazione non creata (sessione ${session.id}): ${error.message}`);
  }

  await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
    user_id: sellerId,
    title: '✨ Sponsorizzazione attiva',
    body: `Il tuo prodotto è "In primo piano" nella ricerca fino al ${endStr}.`,
    link: '/seller/promote',
  });
}
