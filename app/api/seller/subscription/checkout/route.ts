import { NextResponse } from 'next/server';
import { FILTRO_PRIMO_INCASSO } from '@/lib/abbonamento-primo-incasso';
import { ABBONAMENTO_CENTESIMI_MESE, PREZZO_ABBONAMENTO_MESE } from '@/app/seller/earnings/commissione';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { ABBONAMENTO_NEGOZI_ACCESO } from '@/lib/funzioni-al-lancio';

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
// R10-005 — L'importo viene da app/seller/earnings/commissione.ts, lo stesso che leggono le pagine.
const SELLER_SUBSCRIPTION_CENTS = ABBONAMENTO_CENTESIMI_MESE;
/** R10-019 — Le richieste dello stesso negozio dentro questa finestra ricevono la stessa cassa. */
const FINESTRA_CASSA_MS = 10 * 60_000;
/** R10-020 — Un ordine incassato: pagato (carta o contanti registrati), o in contanti e consegnato. */
// La regola sta in lib/abbonamento-primo-incasso.ts: la legge anche il banner (collaudo K03).
const PRIMO_INCASSO = FILTRO_PRIMO_INCASSO;

export const POST = withAuthRateLimit(
  { name: 'seller-subscription-checkout', max: 10, windowMs: 10 * 60_000 },
  async ({ user }): Promise<NextResponse> => {
    // 31/10/2026 — L'abbonamento e le sponsorizzate sono sospesi al lancio
    // (ABBONAMENTO_NEGOZI_ACCESO): niente pagamenti chiesti al negozio, anche con
    // le chiavi Stripe presenti.
    if (!ABBONAMENTO_NEGOZI_ACCESO) return ApiErrors.unavailable('L’abbonamento dei negozi non è attivo al momento.');
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

    // 12/11/2026 (R10-020) — LA REGOLA FIRMATA: IL CANONE PARTE DOPO IL PRIMO INCASSO.
    // Le pagine lo dicevano gia' (commissione.ts, «che parte solo dopo il tuo primo incasso
    // con MyCity»), ma qui bastava l'approvazione: il negozio appena approvato pagava 50 €
    // prima di aver venduto niente. «Primo incasso» = un suo ordine pagato (carta, o contanti
    // gia' registrati: PAID) oppure un ordine in contanti consegnato. Definizione approvata
    // dalla regista, da confermare da Nicola (referto R10).
    const { data: incassi, error: erroreIncassi } = await supa
      .from('orders')
      .select('id')
      .eq('seller_id', user.id)
      .or(PRIMO_INCASSO)
      .limit(1);
    if (erroreIncassi) {
      logger.warn('[subscription] incassi del negozio non letti', { sellerId: user.id, code: erroreIncassi.code });
      return ApiErrors.unavailable('Non riesco a verificare i tuoi incassi. Riprova fra poco.');
    }
    if (!incassi || incassi.length === 0) {
      return ApiErrors.forbidden("L'abbonamento parte solo dopo il tuo primo incasso con MyCity.");
    }

    const stripe = getStripe();

    // R33-008 — UN SOLO CLIENTE STRIPE PER NEGOZIO, PRIMA DELLA CASSA.
    // Senza cliente la cassa partiva con `customer_email` e Stripe creava un cliente nuovo a
    // ogni sessione: con due schede nascevano due abbonamenti su due clienti diversi, il
    // webhook salvava il secondo sopra al primo e il portale («Gestisci abbonamento») apriva
    // solo il secondo. Il primo restava orfano: pagato ogni mese e non disdicibile dal sito.
    // Adesso il cliente si crea qui, una volta, e si salva sul profilo solo se è ancora vuoto:
    // se due schede lo creano insieme vince il primo salvato e tutte e due usano quello.
    let clienteStripe: string | null = profile.stripe_customer_id ?? null;
    if (!clienteStripe) {
      try {
        clienteStripe = await clienteDelNegozio(stripe, user.id, user.email);
      } catch (err) {
        // Stripe o il database non rispondono: si prosegue come prima (il caso peggiore resta quello).
        logger.warn('[subscription] cliente Stripe del negozio non preparato, si prosegue', { sellerId: user.id, err });
      }
    }

    // Il controllo sopra guarda un campo che viene scritto dal webhook DOPO il
    // pagamento: fra il primo clic e l'arrivo del webhook — o con due schede
    // aperte — restava aperta una finestra in cui nascevano due abbonamenti
    // distinti, e il secondo copriva il primo nel profilo. Il negoziante pagava
    // due volte e nel pannello se ne vedeva uno.
    //
    // Qui si chiede a Stripe, che è la fonte vera, invece di fidarsi del nostro
    // campo. Se la chiamata non riesce non si blocca il negoziante: si prosegue,
    // perché il caso peggiore resta quello di prima.
    if (clienteStripe) {
      try {
        const esistenti = await stripe.subscriptions.list({
          customer: clienteStripe,
          status: 'all',
          limit: 10,
        });
        // R33-008 — anche «incompleto»: il primo pagamento è partito e aspetta la conferma.
        const attiva = esistenti.data.find((sub) =>
          ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(sub.status),
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
      // R33-008 — Una cassa dell'abbonamento ancora aperta (l'altra scheda): si ridà quella,
      // non se ne apre una seconda. La chiave qui sotto vale solo dentro la stessa finestra
      // di 10 minuti: due clic alle 10:09 e alle 10:11 aprivano due casse.
      try {
        const aperte = await stripe.checkout.sessions.list({ customer: clienteStripe, status: 'open', limit: 10 });
        const giaAperta = aperte.data.find((s) => s.metadata?.kind === 'seller_subscription' && !!s.url);
        if (giaAperta) return NextResponse.json({ url: giaAperta.url }, { status: 200 });
      } catch (err) {
        logger.warn('[subscription] casse aperte non lette su Stripe, si prosegue', { err });
      }
    }
    const chiaveDellaCassa = `abbonamento-negozio:${user.id}:${Math.floor(Date.now() / FINESTRA_CASSA_MS)}`;
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        // Il cliente del negozio (R33-008); solo se non si è potuto preparare, Stripe lo
        // crea da customer_email e lo recupereremo nel webhook (session.customer).
        ...(clienteStripe
          ? { customer: clienteStripe }
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
                description: `Accesso alla piattaforma per i venditori · ${PREZZO_ABBONAMENTO_MESE}/mese`,
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
      }, { idempotencyKey: chiaveDellaCassa });
      return NextResponse.json({ url: session.url }, { status: 200 });
    } catch (e) {
      logger.error('[seller-subscription] creazione sessione Stripe fallita', e);
      return ApiErrors.internal('Errore nella creazione del pagamento.');
    }
  },
);

/**
 * R33-008 — Il cliente Stripe del negozio: quello già creato per lui (cercato per email e
 * `metadata.seller_id`, se un salvataggio precedente è caduto), altrimenti uno nuovo. Si
 * salva sul profilo SOLO se il campo è ancora vuoto; se un'altra scheda l'ha salvato
 * prima, si rilegge e si usa il suo.
 */
async function clienteDelNegozio(
  stripe: ReturnType<typeof getStripe>,
  sellerId: string,
  email: string,
): Promise<string> {
  const trovati = await stripe.customers.list({ email, limit: 10 });
  const giaFatto = trovati.data.find((c) => c.metadata?.seller_id === sellerId);
  const cliente = giaFatto ?? (await stripe.customers.create({
    email,
    metadata: { kind: 'seller_subscription', seller_id: sellerId },
  }));
  const admin = getAdminSupabase();
  const { data: salvati, error } = await admin
    .from('profiles')
    .update({ stripe_customer_id: cliente.id })
    .eq('id', sellerId)
    .is('stripe_customer_id', null)
    .select('stripe_customer_id');
  if (error) throw new Error(`cliente Stripe non salvato: ${error.message}`);
  if (salvati && salvati.length > 0) return cliente.id;
  const { data: riletto, error: erroreRilettura } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', sellerId)
    .single();
  const vincitore = (riletto as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
  if (erroreRilettura || !vincitore) throw new Error('cliente Stripe del negozio non riletto');
  return vincitore;
}
