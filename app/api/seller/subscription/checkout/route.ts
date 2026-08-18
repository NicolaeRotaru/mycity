import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Attivazione dell'abbonamento venditore (€50/mese) con pagamento REALE via
 * Stripe Subscription. Disponibile SOLO per i venditori già approvati
 * dall'admin (la copy di registrazione promette "addebito solo dopo
 * l'approvazione"). Lo stato abbonamento viene scritto dal webhook
 * (checkout.session.completed, metadata.kind=seller_subscription) e mantenuto
 * sincronizzato dagli eventi customer.subscription.* / invoice.*.
 *
 * Prezzo definito inline (price_data ricorrente) → nessun Price da gestire a
 * mano sul Dashboard Stripe.
 * Rate limit: 10 / 10 min per utente.
 */
const SELLER_SUBSCRIPTION_CENTS = 5000; // €50,00 / mese

export const POST = withAuthRateLimit(
  { name: 'seller-subscription-checkout', max: 10, windowMs: 10 * 60_000 },
  async ({ user }): Promise<NextResponse> => {
    if (!isStripeConfigured()) return ApiErrors.unavailable('Pagamenti non disponibili al momento.');
    if (!user.email) return ApiErrors.unauthorized();

    const supa = await getServerSupabase();
    const { data: profile } = await supa
      .from('profiles')
      .select('role, is_approved, stripe_customer_id, subscription_status')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'seller') return ApiErrors.forbidden('Area riservata ai venditori.');
    if (!profile.is_approved) {
      return ApiErrors.forbidden("L'abbonamento si attiva dopo l'approvazione del negozio.");
    }
    if (profile.subscription_status === 'active') {
      return ApiErrors.invalidRequest('Abbonamento già attivo.');
    }

    const stripe = getStripe();

    // Il controllo sopra guarda un campo che viene scritto dal webhook DOPO il
    // pagamento: fra il primo clic e l'arrivo del webhook — o con due schede
    // aperte — restava aperta una finestra in cui nascevano due abbonamenti
    // distinti, e il secondo copriva il primo nel profilo. Il negoziante pagava
    // due volte e nel pannello se ne vedeva uno.
    //
    // Qui si chiede a Stripe, che è la fonte vera, invece di fidarsi del nostro
    // campo. Se la chiamata non riesce non si blocca il negoziante: si prosegue,
    // perché il caso peggiore resta quello di prima.
    if (profile.stripe_customer_id) {
      try {
        const esistenti = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: 'all',
          limit: 10,
        });
        const attiva = esistenti.data.find((sub) =>
          ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status),
        );
        if (attiva) {
          logger.warn('[subscription] abbonamento già presente su Stripe', {
            sellerId: user.id, subscriptionId: attiva.id, stato: attiva.status,
          });
          return ApiErrors.conflict(
            'Risulta già un abbonamento su questo account. Ricarica la pagina: se non lo vedi, scrivici.',
          );
        }
      } catch (err) {
        logger.warn('[subscription] verifica su Stripe non riuscita, si prosegue', { err });
      }
    }
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        // Riusa il Customer esistente se già creato, altrimenti Stripe lo crea
        // da customer_email e lo recupereremo nel webhook (session.customer).
        ...(profile.stripe_customer_id
          ? { customer: profile.stripe_customer_id }
          : { customer_email: user.email }),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: SELLER_SUBSCRIPTION_CENTS,
              recurring: { interval: 'month' },
              product_data: {
                name: 'Abbonamento venditore MyCity',
                description: 'Accesso alla piattaforma per i venditori · €50/mese',
              },
            },
          },
        ],
        metadata: {
          kind: 'seller_subscription',
          seller_id: user.id,
        },
        subscription_data: {
          metadata: { kind: 'seller_subscription', seller_id: user.id },
        },
        success_url: `${env.appUrl()}/seller/dashboard?subscription=success`,
        cancel_url: `${env.appUrl()}/seller/dashboard?subscription=canceled`,
      });
      return NextResponse.json({ url: session.url }, { status: 200 });
    } catch (e) {
      logger.error('[seller-subscription] creazione sessione Stripe fallita', e);
      return ApiErrors.internal('Errore nella creazione del pagamento.');
    }
  },
);
