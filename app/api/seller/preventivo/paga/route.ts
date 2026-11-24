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
 *  · un cliente Stripe nuovo (da `customer_email`), non quello dell'abbonamento della vetrina:
 *    così il controllo «hai già un abbonamento» della vetrina non scambia l'uno per l'altro.
 */

/** Il buono del primo mese: -50%, una volta sola. Lo stesso per tutti, creato la prima volta che serve. */
export const BUONO_PRIMO_MESE = 'mycity-servizi-primo-mese-meta';

/** Le richieste dello stesso negozio e della stessa fascia dentro questa finestra ricevono la stessa cassa. */
const FINESTRA_CASSA_MS = 10 * 60_000;

async function buonoPrimoMese(stripe: Stripe): Promise<string> {
  try {
    return (await stripe.coupons.retrieve(BUONO_PRIMO_MESE)).id;
  } catch {
    try {
      return (await stripe.coupons.create({
        id: BUONO_PRIMO_MESE,
        percent_off: Math.round(CONDIZIONI.primoMeseFrazione * 100),
        duration: 'once',
        name: 'Primo mese a metà prezzo',
      })).id;
    } catch {
      // Due casse insieme: l'altra l'ha appena creato.
      return (await stripe.coupons.retrieve(BUONO_PRIMO_MESE)).id;
    }
  }
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
      admin.from('abbonamenti_servizi').select('fascia').eq('seller_id', user.id).in('stato', ['active', 'past_due']).limit(1),
    ]);
    // Senza la tabella (migrazione 706 non applicata) il pagamento non deve partire: il webhook
    // non saprebbe dove scriverlo, e il negozio pagherebbe senza vedere l'abbonamento attivo.
    if (attivi.error) {
      logger.error('[servizi] abbonamenti non letti: niente cassa', { userId: user.id, message: attivi.error.message });
      return ApiErrors.unavailable('Il pagamento non è disponibile in questo momento. Riprova fra poco o scrivici.');
    }
    if ((attivi.data ?? []).length > 0) {
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
      const sessione = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: user.email,
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
        discounts: [{ coupon: await buonoPrimoMese(stripe) }],
        metadata: metadati,
        subscription_data: { metadata: metadati },
        success_url: `${env.appUrl()}/seller/preventivo?pagato=1`,
        cancel_url: `${env.appUrl()}/seller/preventivo?pagato=0`,
      }, { idempotencyKey: `servizi:${user.id}:${fascia}:${canone}:${Math.floor(Date.now() / FINESTRA_CASSA_MS)}` });
      if (!sessione.url) throw new Error('sessione senza indirizzo');
      return NextResponse.json({ ok: true, data: { url: sessione.url } }, { status: 200 });
    } catch (errore) {
      logger.error('[servizi] cassa Stripe non creata', { userId: user.id, fascia, errore: String(errore) });
      return ApiErrors.internal('Non sono riuscito ad aprire il pagamento. Riprova fra un momento.');
    }
  },
);
