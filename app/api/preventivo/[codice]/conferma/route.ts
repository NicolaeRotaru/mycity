import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { isStripeConfigured } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';
import { ABBONAMENTI } from '@/lib/agenzia/preventivo';
import { apriCassaDalLink } from '@/lib/agenzia/cassa-dal-link';
import { pagamentoOnlineAttivo } from '@/lib/agenzia/pagamento-servizi';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { accettaPreventivoColCodice, CODICE_VALIDO, leggiPreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';
import { sessioneDalLink, type SessioneDalLink } from '@/lib/agenzia/entra-dal-link';
import { richiestaDalSito } from '@/lib/agenzia/richiesta-dal-sito';

export const runtime = 'nodejs';

/**
 * IL TITOLARE CONFERMA COL CODICE ED ENTRA — 27/11/2026.
 *
 * Nicola: «può toccare un altro abbonamento e confermare quello e dopo il click entra nella sua pagina
 * venditore con l'abbonamento che ha scelto»; sul rischio trovato dal collaudo, «codice dall'email».
 * Qui, nell'ordine:
 *  1. il codice dell'email si verifica (lib/agenzia/entra-dal-link.ts): prova che l'email è sua. Sbagliato
 *     o scaduto → niente si accetta, e lo si dice;
 *  2. l'utente entrato deve essere quello dell'attività del link, se no niente;
 *  3. si accetta come prima (lib/agenzia/preventivo-col-codice.ts): profilo in revisione, pagina sbloccata
 *     nella fascia confermata, avviso a Nicola, email col link per rientrare;
 *  4. la risposta porta i cookie della sessione e `entra`, la pagina dell'abbonamento del negozio.
 * Se in questo browser c'è già dentro un altro account, il codice si verifica lo stesso (prova l'email e
 * accetta) ma la sua sessione non si tocca: `entra` è null e il titolare entra dal link dell'email.
 * Tetto ai tentativi: 10 per indirizzo e 10 per link ogni 15 minuti (il codice ha 6 cifre).
 */

const Richiesta = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Scrivi un’email valida'),
  abbonamento: z.enum(ABBONAMENTI, { message: 'Scegli uno dei tre abbonamenti' }),
  accettoCondizioni: z.literal(true, { message: 'Per continuare accetta le condizioni e l’informativa privacy' }),
  codice: z.string().trim().regex(/^[0-9]{6,10}$/, 'Scrivi il codice di 6 cifre che ti è arrivato per email'),
});

const QUARTO_D_ORA = 15 * 60_000;

export async function POST(req: Request, ctx: { params: Promise<{ codice: string }> }): Promise<NextResponse> {
  const { codice } = await ctx.params;
  if (!CODICE_VALIDO.test(codice)) return ApiErrors.notFound('Preventivo non trovato');
  const fuori = richiestaDalSito(req, '[preventivo-codice] conferma');
  if (fuori) return fuori;

  const perIndirizzo = await rateLimitAsync({ key: `preventivo-conferma:${getClientIp(req)}`, max: 10, windowMs: QUARTO_D_ORA });
  if (!perIndirizzo.allowed) return ApiErrors.rateLimited(perIndirizzo.retryAfterSec);
  const perLink = await rateLimitAsync({ key: `preventivo-conferma-link:${codice}`, max: 10, windowMs: QUARTO_D_ORA });
  if (!perLink.allowed) return ApiErrors.rateLimited(perLink.retryAfterSec);

  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
  const { email, abbonamento, codice: codiceEmail } = esito.data;

  let preventivo;
  try {
    preventivo = await leggiPreventivoColCodice(codice);
  } catch (errore) {
    logger.error('[preventivo-codice] lettura non riuscita (conferma)', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il preventivo in questo momento. Riprova fra poco.');
  }
  if (!preventivo) return ApiErrors.notFound('Preventivo non trovato');
  if (preventivo.stato === 'accettato') return ApiErrors.conflict('Questo preventivo è già stato accettato: controlla la tua email per entrare.');
  if (preventivo.stato === 'chiuso') return ApiErrors.conflict('Questo preventivo non è più valido. Scrivici e te ne prepariamo uno nuovo.');

  // 1-2) Il codice prova che l'email è sua, e deve essere l'utente dell'attività di questo link.
  const sessione = sessioneDalLink(req.headers.get('cookie'));
  if (!sessione) return ApiErrors.unavailable('Non riesco a controllare il codice in questo momento. Riprova fra poco.');
  const altro = await sessione.dentroUnAltro(preventivo.sellerId);
  const entrato = await sessione.entraColCodice(email, codiceEmail);
  if (entrato !== preventivo.sellerId) {
    if (entrato !== null) logger.error('[preventivo-codice] il codice ha aperto un utente diverso da quello del link', { sellerId: preventivo.sellerId });
    return ApiErrors.invalidRequest('Il codice non è giusto o è scaduto. Controlla l’ultima email che ti abbiamo mandato, o chiedine un altro.');
  }

  // 3) Ora si accetta, come prima.
  const accettato = await accettaPreventivoColCodice({ preventivo, codice, email, fascia: abbonamento });
  if (!accettato.ok) {
    if (accettato.motivo === 'GUASTO') return ApiErrors.unavailable(accettato.messaggio);
    return ApiErrors.conflict(accettato.messaggio);
  }

  // 4) La pagina dell'abbonamento del negozio, dove vede la fascia confermata attiva (non la dashboard,
  // che a un negozio in revisione mostra solo «in attesa di approvazione»: collaudo del 27/11).
  const base = { accessoInviato: accettato.accessoInviato, entra: altro ? null : PERCORSO_ABBONAMENTO };
  const conCookie = altro ? null : sessione;
  if (!pagamentoOnlineAttivo() || !isStripeConfigured()) {
    return conLaSessione({ ok: true, data: { url: null, ...base } }, conCookie);
  }
  const cassa = await apriCassaDalLink({ codice, sellerId: accettato.sellerId, email, fascia: abbonamento });
  if (!cassa.ok) return conLaSessione({ ok: true, data: { url: null, ...base } }, conCookie);
  const dati = (await cassa.json()) as { data?: { url?: string } };
  return conLaSessione({ ok: true, data: { url: dati.data?.url ?? null, ...base } }, conCookie);
}

/** La risposta col corpo e coi cookie della sessione appena aperta (anche le cancellazioni). */
function conLaSessione(corpo: unknown, sessione: SessioneDalLink | null): NextResponse {
  const risposta = NextResponse.json(corpo, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  for (const c of sessione?.scritti ?? []) risposta.cookies.set({ name: c.name, value: c.value, ...c.options });
  return risposta;
}
