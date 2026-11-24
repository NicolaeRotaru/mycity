import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withSellerAuthRateLimit } from '@/lib/api/middleware';
import { isStripeConfigured } from '@/lib/stripe/client';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { env } from '@/lib/env';
import { ABBONAMENTI } from '@/lib/agenzia/preventivo';
import { apriCassaServizi } from '@/lib/agenzia/cassa-servizi';

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

export { BUONO_PRIMO_MESE } from '@/lib/agenzia/cassa-servizi';

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

    return apriCassaServizi({
      sellerId: user.id,
      email: user.email,
      fascia,
      ritorno: { pagato: `${env.appUrl()}/seller/preventivo?pagato=1`, annullato: `${env.appUrl()}/seller/preventivo?pagato=0` },
    });
  },
);
