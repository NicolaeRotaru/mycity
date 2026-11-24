import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';
import { withSellerAuthRateLimit } from '@/lib/api/middleware';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { ABBONAMENTI, CONDIZIONI, FASCE, leggiImpostazioniAgenzia } from '@/lib/agenzia/preventivo';
import { KIND_SERVIZI } from '@/lib/stripe/webhook/servizi';

export const runtime = 'nodejs';

/**
 * PAGA L'ABBONAMENTO DEI SERVIZI — 24/11/2026.
 *
 * Nicola: «Ora del Gusto deve già poter selezionare il servizio e effettuare il pagamento», e
 * «sono servizi che offre mycity, ma tramite SDG». Il negozio sceglie la fascia e qui nasce la
 * cassa Stripe: un abbonamento mensile al canone della fascia, col primo mese a metà prezzo
 * (un buono Stripe da -50% che vale una volta sola). L'abbonamento lo attiva il webhook
 * (`lib/stripe/webhook/servizi.ts`), che lo scrive in `abbonamenti_servizi`.
 *
 * Tre scelte di sicurezza:
 *  · il canone lo rilegge il server (listino o `site_settings.agenzia.abbonamenti`), il browser
 *    manda solo il nome della fascia;
 *  · niente `client_reference_id`: il gestore delle casse scadute lo legge come numero di un
 *    carrello (`carrello-scaduto.ts`), e questa cassa non è un carrello;
 *  · un cliente Stripe dei servizi, uno per negozio (`metadata.kind = servizi_subscription`), non
 *    quello della vetrina: così i due controlli «hai già un abbonamento» non si scambiano.
 *
 * Dal collaudo del 24/11 (due difetti gravi e uno minore):
 *  · DUE ABBONAMENTI PAGATI: una scheda Base e una Business aprivano due casse, tutte e due pagabili
 *    per 24 ore. Adesso su Stripe si guarda il cliente dei servizi: un abbonamento in corso ferma
 *    la cassa; una cassa ancora aperta della stessa fascia si ridà, una di un'altra fascia si chiude
 *    prima di aprirne una nuova; ogni cassa scade dopo 30 minuti. Se due casse nascono comunque
 *    insieme, il webhook avvisa del doppione (servizi.ts).
 *  · IL BUONO SBAGLIATO: si usa solo se è esattamente -50% per un mese; altrimenti niente cassa.
 *  · IL PRIMO MESE A METÀ UNA VOLTA SOLA: a chi ha già avuto un abbonamento dei servizi non si dà più.
 */

/** Il buono del primo mese: -50%, una volta sola. Lo stesso per tutti, creato la prima volta che serve. */
const BUONO_PRIMO_MESE = 'mycity-servizi-primo-mese-meta';

/** Le richieste dello stesso negozio e della stessa fascia dentro questa finestra ricevono la stessa cassa. */
const FINESTRA_CASSA_MS = 10 * 60_000;

/** Gli stati di un abbonamento Stripe ancora in corso (o col primo pagamento in arrivo). */
const IN_CORSO = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

/** Quanto dura una cassa aperta: il minimo che Stripe accetta. */
const CASSA_SCADE_DOPO_S = 30 * 60 + 60;

const PERCENTO_PRIMO_MESE = Math.round(CONDIZIONI.primoMeseFrazione * 100);

class BuonoSbagliato extends Error {}

/** Il buono va bene solo se è esattamente lo sconto promesso in pagina: -50%, una volta, ancora valido. */
function buonoGiusto(c: Stripe.Coupon): boolean {
  return c.percent_off === PERCENTO_PRIMO_MESE && !c.amount_off && c.duration === 'once' && c.valid !== false;
}

async function buonoPrimoMese(stripe: Stripe): Promise<string> {
  let buono: Stripe.Coupon | null = null;
  try {
    buono = await stripe.coupons.retrieve(BUONO_PRIMO_MESE);
  } catch {
    try {
      buono = await stripe.coupons.create({
        id: BUONO_PRIMO_MESE,
        percent_off: PERCENTO_PRIMO_MESE,
        duration: 'once',
        name: 'Primo mese a metà prezzo',
      });
    } catch {
      // Due casse insieme: l'altra l'ha appena creato.
      buono = await stripe.coupons.retrieve(BUONO_PRIMO_MESE);
    }
  }
  // Un buono con lo stesso nome ma un altro sconto (fatto a mano sul cruscotto) farebbe pagare al
  // negozio un prezzo diverso da quello scritto, o regalerebbe mesi interi: niente cassa.
  if (!buonoGiusto(buono)) throw new BuonoSbagliato(`buono ${BUONO_PRIMO_MESE} diverso da -${PERCENTO_PRIMO_MESE}% una volta`);
  return buono.id;
}

/** Il cliente Stripe dei servizi del negozio: quello già fatto (stessa email e stesso seller_id), o uno nuovo. */
async function clienteDeiServizi(stripe: Stripe, sellerId: string, email: string, negozio: string): Promise<string> {
  const trovati = await stripe.customers.list({ email, limit: 20 });
  const giaFatto = trovati.data.find((c) => c.metadata?.kind === KIND_SERVIZI && c.metadata?.seller_id === sellerId);
  if (giaFatto) return giaFatto.id;
  return (await stripe.customers.create({ email, name: negozio, metadata: { kind: KIND_SERVIZI, seller_id: sellerId } })).id;
}

const Richiesta = z.object({ abbonamento: z.enum(ABBONAMENTI, { message: 'Scegli uno dei tre abbonamenti' }) });

export const POST = withSellerAuthRateLimit(
  { name: 'seller-preventivo-paga', max: 10, windowMs: 10 * 60_000 },
  async ({ user, req }): Promise<NextResponse> => {
    if (!isStripeConfigured()) return ApiErrors.unavailable('I pagamenti non sono disponibili in questo momento. Scrivici e ti richiamiamo.');
    if (!user.email) return ApiErrors.unauthorized();

    let corpo: unknown;
    try {
      corpo = await jsonRichiesta(req, TETTO_JSON);
    } catch (errore) {
      if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
      return ApiErrors.invalidRequest('Richiesta non leggibile');
    }
    const esito = Richiesta.safeParse(corpo);
    if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
    const fascia = esito.data.abbonamento;

    const admin = getAdminSupabase();
    const [profilo, impostazioni, attivi] = await Promise.all([
      admin.from('profiles').select('store_name').eq('id', user.id).maybeSingle(),
      admin.from('site_settings').select('agenzia').eq('id', 1).maybeSingle(),
      // Tutte le righe del negozio, anche disdette: servono anche per sapere se il primo mese a metà l'ha già avuto.
      admin.from('abbonamenti_servizi').select('fascia, stato').eq('seller_id', user.id).limit(20),
    ]);
    // Senza la tabella (migrazione 706 non applicata) il pagamento non deve partire: il webhook
    // non saprebbe dove scriverlo, e il negozio pagherebbe senza vedere l'abbonamento attivo.
    if (attivi.error) {
      logger.error('[servizi] abbonamenti non letti: niente cassa', { userId: user.id, message: attivi.error.message });
      return ApiErrors.unavailable('Il pagamento non è disponibile in questo momento. Riprova fra poco o scrivici.');
    }
    const righe = (attivi.data ?? []) as { stato: string }[];
    if (righe.some((r) => r.stato === 'active' || r.stato === 'past_due')) {
      return ApiErrors.conflict('Hai già un abbonamento attivo. Per cambiarlo scrivici: lo sistemiamo noi.');
    }
    // Il canone: con le impostazioni non lette, nessun prezzo (mai un prezzo sbagliato in cassa).
    const canone = impostazioni.error ? null : leggiImpostazioniAgenzia(impostazioni.data?.agenzia).prezzi[fascia];
    if (!canone) {
      return ApiErrors.conflict('Il prezzo di questo abbonamento te lo confermiamo noi: premi «Preferisco essere richiamato».');
    }
    const negozio = String((profilo.data as { store_name?: string | null } | null)?.store_name ?? '').trim() || 'Negozio';
    const nome = FASCE[fascia].nome;
    const metadati = { kind: KIND_SERVIZI, seller_id: user.id, fascia, canone_centesimi: String(canone), negozio: negozio.slice(0, 120) };

    const stripe = getStripe();
    try {
      const cliente = await clienteDeiServizi(stripe, user.id, user.email, negozio);
      // Su Stripe, che è la fonte vera: un abbonamento dei servizi già in corso ferma la cassa.
      const abbonamenti = await stripe.subscriptions.list({ customer: cliente, status: 'all', limit: 20 });
      if (abbonamenti.data.some((a) => IN_CORSO.includes(a.status))) {
        return ApiErrors.conflict('Risulta già un abbonamento in corso. Ricarica la pagina fra un momento; se non lo vedi, scrivici.');
      }
      // Una cassa ancora aperta: della stessa fascia e allo stesso prezzo si ridà; di un'altra si chiude.
      const aperte = await stripe.checkout.sessions.list({ customer: cliente, status: 'open', limit: 10 });
      for (const a of aperte.data.filter((x) => x.metadata?.kind === KIND_SERVIZI)) {
        if (a.metadata?.fascia === fascia && a.metadata?.canone_centesimi === String(canone) && a.url) {
          return NextResponse.json({ ok: true, data: { url: a.url } }, { status: 200 });
        }
        await stripe.checkout.sessions.expire(a.id);
      }
      // Il primo mese a metà vale una volta per negozio: non a chi ha già avuto un abbonamento dei servizi.
      const primaVolta = righe.length === 0 && abbonamenti.data.length === 0;
      const sessione = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer: cliente,
        expires_at: Math.floor(Date.now() / 1000) + CASSA_SCADE_DOPO_S,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: canone,
            recurring: { interval: 'month' },
            product_data: {
              name: `Servizi MyCity · ${nome}`,
              description: 'Foto e video, social, sito web e scheda Google, realizzati da SDG Agenzia per MyCity.',
            },
          },
        }],
        ...(primaVolta ? { discounts: [{ coupon: await buonoPrimoMese(stripe) }] } : {}),
        metadata: metadati,
        subscription_data: { metadata: metadati },
        success_url: `${env.appUrl()}/seller/preventivo?pagato=1`,
        cancel_url: `${env.appUrl()}/seller/preventivo?pagato=0`,
      }, { idempotencyKey: `servizi:${user.id}:${fascia}:${canone}:${Math.floor(Date.now() / FINESTRA_CASSA_MS)}` });
      if (!sessione.url) throw new Error('sessione senza indirizzo');
      return NextResponse.json({ ok: true, data: { url: sessione.url } }, { status: 200 });
    } catch (errore) {
      if (errore instanceof BuonoSbagliato) {
        logger.error('[servizi] buono del primo mese diverso da quello promesso: niente cassa', { userId: user.id, errore: errore.message });
        return ApiErrors.unavailable('Il pagamento non è disponibile in questo momento. Scrivici e ti richiamiamo.');
      }
      logger.error('[servizi] cassa Stripe non creata', { userId: user.id, fascia, errore: String(errore) });
      return ApiErrors.internal('Non sono riuscito ad aprire il pagamento. Riprova fra un momento.');
    }
  },
);
