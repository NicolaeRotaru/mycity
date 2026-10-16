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
import { scritturaFacoltativa, scritturaObbligatoria } from './esito';

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
 * 16/10/2026 (quinto riesame del lotto) — L'AVVISO VECCHIO NON RISCRIVE LO STATO NUOVO.
 *
 * Gli avvisi degli abbonamenti scrivevano lo stato che portavano dentro. Da
 * quando una scrittura caduta fa riprovare Stripe (R81), un avviso vecchio può
 * arrivare DOPO uno nuovo. Un caso: alle 10:00 arriva «in ritardo» e la
 * scrittura va in timeout; alle 10:30 il negozio aggiorna la carta e arriva
 * «attivo», che passa; alle 11:00 Stripe riprova l'avviso delle 10:00 e il
 * negozio che ha pagato torna «in ritardo di pagamento» fino al rinnovo dopo.
 * Al contrario, un pagamento dell'abbonamento riprovato dopo la disdetta lo
 * rimetteva «attivo».
 *
 * Adesso i tre gestori chiedono a Stripe com'è l'abbonamento in questo momento
 * e scrivono quello: l'ordine in cui arrivano gli avvisi non conta più.
 */
export async function statoDaStripe(
  subscriptionId: string,
): Promise<{ subscription_status: 'active' | 'past_due' | 'canceled'; subscription_renews_at: string | null }> {
  const attuale = await getStripe().subscriptions.retrieve(subscriptionId);
  return {
    subscription_status: mapSubscriptionStatus(attuale.status),
    subscription_renews_at: attuale.current_period_end ? new Date(attuale.current_period_end * 1000).toISOString() : null,
  };
}

/**
 * L'abbonamento per cui è stata fatta la fattura. Stripe lo scrive in
 * `invoice.subscription` fino alla versione 2024-06-20 delle sue risposte, e in
 * `invoice.parent.subscription_details.subscription` da quelle più nuove: gli
 * avvisi arrivano nella versione impostata sul cruscotto, non in quella del
 * codice, quindi si guardano tutti e due.
 */
export function abbonamentoDellaFattura(invoice: Stripe.Invoice): string | null {
  const diretto = (invoice as { subscription?: string | { id?: string } | null }).subscription;
  const dalGenitore = (invoice as { parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null })
    .parent?.subscription_details?.subscription;
  for (const s of [diretto, dalGenitore]) {
    if (typeof s === 'string' && s) return s;
    if (s && typeof s === 'object' && s.id) return s.id;
  }
  return null;
}

/** L'abbonamento salvato sul profilo del negozio di quel cliente Stripe, se c'è. */
async function abbonamentoDelNegozio(customerId: string): Promise<string | null> {
  const { data, error } = await getAdminSupabase()
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('stripe_customer_id', customerId);
  // Una lettura caduta non è «nessun abbonamento»: Stripe riprova.
  if (error) throw new Error(`[stripe] abbonamento del negozio non letto: ${error.message}`);
  const riga = ((data ?? []) as Array<{ stripe_subscription_id?: string | null }>).find((r) => !!r.stripe_subscription_id);
  return riga?.stripe_subscription_id ?? null;
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

  // 16/10/2026 (quinto riesame del lotto) — Lo stato si rilegge da Stripe
  // adesso, non si scrive «attivo» a occhi chiusi: se questo avviso è un
  // ritentativo arrivato dopo la disdetta, l'abbonamento è già cancellato e
  // «attivo» sarebbe una bugia (vedi `statoDaStripe`). Se Stripe non risponde,
  // si lancia e Stripe riprova: meglio qualche minuto di ritardo che uno stato inventato.
  const { subscription_status: stato, subscription_renews_at: renewsAt } = await statoDaStripe(subscriptionId);

  // R81 — Il negozio ha pagato 50 €: se l'attivazione non si scrive, Stripe
  // deve riprovare. Prima il gestore finiva «bene» e l'abbonamento pagato
  // restava spento. Riscrivere gli stessi valori a ogni tentativo è innocuo.
  scritturaObbligatoria(
    await admin
      .from('profiles')
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        subscription_status: stato,
        subscription_renews_at: renewsAt,
      })
      .eq('id', sellerId),
    'attivazione abbonamento venditore',
  );
  // Un ritentativo vecchio su un abbonamento che non è più attivo: niente «grazie, è attivo».
  if (stato !== 'active') return;

  // Avviso di contorno: l'abbonamento è già attivo, una campanella mancata non
  // vale un nuovo giro di Stripe.
  scritturaFacoltativa(
    await admin.from('notifications').insert({
      // #33 — la categoria decide se la persona vuole ancora ricevere
      // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
      category: 'order',
      user_id: sellerId,
      title: '✅ Abbonamento attivo',
      body: 'Il tuo abbonamento venditore (€50/mese) è attivo. Grazie!',
      link: '/seller/dashboard',
    }),
    'avviso abbonamento attivo',
  );
}

/**
 * customer.subscription.updated / .deleted → sincronizza subscription_status e
 * subscription_renews_at sul profilo del venditore (lookup per subscription id).
 */
export async function handleSubscriptionChanged(sub: Stripe.Subscription) {
  const admin = getAdminSupabase();
  // Lo stato di ADESSO, non la fotografia dentro l'avviso (vedi `statoDaStripe`).
  scritturaObbligatoria(
    await admin
      .from('profiles')
      .update(await statoDaStripe(sub.id))
      .eq('stripe_subscription_id', sub.id),
    'stato abbonamento venditore',
  );
}

/**
 * invoice.payment_failed → la carta del venditore è stata rifiutata: marca
 * l'abbonamento past_due (lookup per customer id) e avvisa il venditore.
 */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null);
  if (!customerId) return;
  const admin = getAdminSupabase();
  // 16/10/2026 (quinto riesame del lotto) — La fattura rifiutata può essere un
  // ritentativo di Stripe arrivato dopo che il negozio ha già pagato: si chiede
  // a Stripe com'è l'abbonamento adesso, e se non è più in ritardo non si
  // scrive niente e non si avvisa (vedi `statoDaStripe`).
  const subscriptionId = abbonamentoDellaFattura(invoice) ?? (await abbonamentoDelNegozio(customerId));
  if (subscriptionId) {
    const adesso = await statoDaStripe(subscriptionId);
    if (adesso.subscription_status !== 'past_due') {
      logger.info('[stripe] fattura rifiutata, ma l abbonamento oggi non è in ritardo: niente da scrivere', {
        invoiceId: invoice.id, subscriptionId, stato: adesso.subscription_status,
      });
      return;
    }
  }
  // R81 — Se la scrittura falliva, `rows` restava vuoto e il gestore lo
  // leggeva come «nessun negozio da avvisare»: abbonamento ancora «attivo» su
  // una carta rifiutata, e Stripe non riprovava.
  const { data: rows } = scritturaObbligatoria(
    await admin
      .from('profiles')
      .update({ subscription_status: 'past_due' })
      .eq('stripe_customer_id', customerId)
      .select('id'),
    'abbonamento in ritardo di pagamento',
  );
  for (const r of rows ?? []) {
    scritturaFacoltativa(
      await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
        user_id: r.id,
        title: '⚠️ Pagamento abbonamento non riuscito',
        body: 'Non siamo riusciti ad addebitare l’abbonamento mensile. Aggiorna il metodo di pagamento.',
        link: '/seller/dashboard',
      }),
      'avviso pagamento abbonamento non riuscito',
    );
  }
}
