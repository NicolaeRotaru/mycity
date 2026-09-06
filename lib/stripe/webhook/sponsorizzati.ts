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
import { giornoLocale } from '@/lib/tempo/giorno-locale';
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

  /**
   * 6/9/2026 — LA VETRINA COMPRATA DI NOTTE PARTIVA DAL GIORNO PRIMA.
   *
   * `toISOString()` dà il giorno di Greenwich. Fra mezzanotte e le due di
   * notte (l'una d'inverno) a Piacenza è già domani e a Greenwich è ancora
   * ieri: chi comprava sette giorni di vetrina alle 00:30 se li vedeva
   * scritti come iniziati il giorno prima, e finiti un giorno prima del
   * dovuto. Poco denaro, ma è il torto che il negoziante nota e racconta.
   *
   * `giornoLocale()` è la stessa funzione con cui si quadra la cassa del
   * fattorino (lib/tempo/giorno-locale.ts): la giornata è una sola per tutti.
   */
  const oggi = new Date();
  const fine = new Date(oggi.getTime() + days * 86_400_000);
  const startStr = giornoLocale(oggi);
  const endStr = giornoLocale(fine);

  /**
   * E LA SPESA È QUELLA CHE STRIPE HA DAVVERO INCASSATO.
   *
   * `amount_cents` arriva dai metadati della sessione, cioè da quello che
   * avevamo chiesto; `amount_total` è quello che è entrato in cassa. Se i due
   * divergono — un prezzo cambiato mentre la cassa era aperta, un buono
   * applicato da Stripe — il rendiconto della sponsorizzazione racconterebbe
   * una cifra che nessuno ha pagato. Comanda la cassa; i metadati restano
   * come ripiego se Stripe non manda il totale, e la differenza resta scritta.
   */
  const incassato = typeof session.amount_total === 'number' ? session.amount_total : null;
  const speso = incassato ?? amountCents;
  if (incassato !== null && incassato !== amountCents) {
    logger.warn('[stripe] sponsorizzazione: importo incassato diverso dai metadati', {
      sessionId: session.id, incassato, metadati: amountCents,
    });
  }
  const perDay = days > 0 ? Math.round(speso / days) : speso;

  const { error } = await admin.from('sponsored_listings').insert({
    product_id: productId,
    seller_id: sellerId,
    placement,
    category_slug: null,
    start_date: startStr,
    end_date: endStr,
    daily_budget_cents: perDay,
    spent_cents: speso,
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
