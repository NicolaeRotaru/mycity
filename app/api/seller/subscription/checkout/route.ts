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

    // 13/11/2026 (R23-011) — UN CLIENTE STRIPE SOLO PER NEGOZIO, PRIMA DELLA CASSA.
    // Al primo abbonamento la cassa partiva con `customer_email`, e Stripe creava un cliente
    // nuovo a ogni pagamento: due schede pagate facevano due clienti, il controllo qui sotto
    // (che chiede per cliente) non vedeva l'altro abbonamento, e il webhook salvava sul profilo
    // l'ultimo. Il portale si apre su quel cliente: il primo abbonamento, da 50 € al mese,
    // dal sito non si disdiceva piu'. Adesso il cliente si trova (o si crea) prima, e tutte le
    // casse e tutti gli abbonamenti del negozio stanno sullo stesso.
    // Se il cliente non si prepara, la cassa NON parte: con `customer_email` il doppione tornava
    // (una caduta, la seconda scheda venti minuti dopo: due casse su due clienti).
    // Il cliente si salva subito sul profilo: se la cassa resta abbandonata e l'account si
    // cancella, la cancellazione (lib/account/cancellazione.ts) lo trova e lo toglie da Stripe.
    let clienteStripe: string | null = profile.stripe_customer_id ?? null;
    if (!clienteStripe) {
      try {
        clienteStripe = await clienteDelNegozio(stripe, user.id, user.email);
      } catch (err) {
        logger.warn('[subscription] cliente Stripe del negozio non preparato: niente cassa', { err });
        return ApiErrors.unavailable('Pagamento non disponibile al momento. Riprova fra poco.');
      }
      const { error: erroreCliente } = await getAdminSupabase()
        .from('profiles')
        .update({ stripe_customer_id: clienteStripe })
        .eq('id', user.id)
        .is('stripe_customer_id', null);
      if (erroreCliente) {
        logger.warn('[subscription] cliente Stripe non salvato sul profilo: niente cassa', {
          sellerId: user.id, code: erroreCliente.code,
        });
        return ApiErrors.unavailable('Pagamento non disponibile al momento. Riprova fra poco.');
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
    try {
      const esistenti = await stripe.subscriptions.list({
        customer: clienteStripe,
        status: 'all',
        limit: 10,
      });
      const attiva = esistenti.data.find((sub) => ABBONAMENTO_VIVO.includes(sub.status))
        ?? (await abbonamentoVivoAltrove(stripe, user.id));
      if (attiva) {
        logger.warn('[subscription] abbonamento già presente su Stripe', {
          sellerId: user.id, subscriptionId: attiva.id, stato: attiva.status,
        });
        return ApiErrors.conflict(
          'Risulta già un abbonamento su questo account. Ricarica la pagina: se non lo vedi, scrivici.',
        );
      }
      // R23-011 — La chiave qui sotto vale dieci minuti: due schede aperte a cavallo della
      // finestra (o la seconda un quarto d'ora dopo) avevano due casse vive, tutte e due
      // pagabili. Una cassa ancora aperta dello stesso negozio si riusa: si paga una volta sola.
      const aperte = await stripe.checkout.sessions.list({ customer: clienteStripe, status: 'open', limit: 10 });
      const aperta = aperte.data.find((s) =>
        s.metadata?.kind === 'seller_subscription' && s.metadata?.seller_id === user.id && !!s.url,
      );
      if (aperta) return NextResponse.json({ url: aperta.url }, { status: 200 });
    } catch (err) {
      logger.warn('[subscription] verifica su Stripe non riuscita, si prosegue', { err });
    }
    // 12/11/2026 (R10-019) — Il controllo qui sopra non vede le casse ancora aperte: con due
    // schede (o senza `stripe_customer_id`, al primo abbonamento) nascevano due sessioni e due
    // abbonamenti. La chiave di idempotenza fa rispondere a Stripe con LA STESSA sessione a
    // tutte le richieste dello stesso negozio nella stessa finestra di 10 minuti.
    const chiaveDellaCassa = `abbonamento-negozio:${user.id}:${Math.floor(Date.now() / FINESTRA_CASSA_MS)}`;
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        // R23-011 — Sempre il cliente del negozio, mai `customer_email`: con quello Stripe creava
        // un cliente nuovo a ogni pagamento.
        customer: clienteStripe,
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

const ABBONAMENTO_VIVO = ['active', 'trialing', 'past_due', 'unpaid'];

/**
 * R23-011 — Il cliente Stripe del negozio: quello già creato per lui (stessa email, segnato col
 * suo id), oppure uno nuovo. Due richieste nello stesso istante portano la stessa chiave di
 * idempotenza: su Stripe la seconda, mentre la prima è ancora in corso, riceve un 409 (non lo
 * stesso cliente). Allora si cerca di nuovo; se il cliente non si vede ancora, l'errore sale e
 * quella scheda riceve «Riprova fra poco». Dopo, lo ritrova la ricerca per email.
 */
async function clienteDelNegozio(stripe: ReturnType<typeof getStripe>, sellerId: string, email: string): Promise<string> {
  const cerca = async () => {
    const trovati = await stripe.customers.list({ email, limit: 100 });
    return trovati.data.find((c) => c.metadata?.seller_id === sellerId)?.id ?? null;
  };
  const suo = await cerca();
  if (suo) return suo;
  try {
    const nuovo = await stripe.customers.create(
      { email, metadata: { seller_id: sellerId } },
      { idempotencyKey: `cliente-negozio:${sellerId}` },
    );
    return nuovo.id;
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode !== 409) throw err;
    const dopo = await cerca();
    if (dopo) return dopo;
    throw err;
  }
}

/**
 * R23-011 — Un abbonamento vivo del negozio su un altro cliente: un orfano nato prima della
 * correzione, quando ogni cassa pagata faceva un cliente nuovo. Lo trova la ricerca per
 * `seller_id` nei metadati. Se la ricerca non riesce non si blocca niente: è un controllo in più.
 */
async function abbonamentoVivoAltrove(stripe: ReturnType<typeof getStripe>, sellerId: string) {
  try {
    const trovati = await stripe.subscriptions.search({ query: `metadata['seller_id']:'${sellerId}'`, limit: 10 });
    return trovati.data.find((sub) => ABBONAMENTO_VIVO.includes(sub.status));
  } catch (err) {
    logger.warn('[subscription] ricerca degli abbonamenti del negozio non riuscita', { err });
    return undefined;
  }
}
