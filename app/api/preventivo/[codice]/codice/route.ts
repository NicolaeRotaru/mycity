import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { codiceDelPreventivoTemplate } from '@/lib/email/templates';
import { ABBONAMENTI, FASCE } from '@/lib/agenzia/preventivo';
import { CODICE_VALIDO, leggiPreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';
import { creaCodice } from '@/lib/agenzia/codice-dal-link';
import { richiestaDalSito } from '@/lib/agenzia/richiesta-dal-sito';

export const runtime = 'nodejs';

/**
 * IL TITOLARE CHIEDE IL CODICE PER CONFERMARE — 27/11/2026 (Nicola: «codice dall'email»).
 *
 * La pagina del link (app/preventivo/[codice]/page.tsx) manda la fascia scelta e l'email. Qui nasce il codice
 * (lib/agenzia/codice-dal-link.ts) e parte per email; al browser torna solo il gettone firmato, che non
 * contiene il codice in chiaro. NON si tocca niente: né l'utente del negozio, né il preventivo. Si accetta
 * solo col codice giusto (../accetta). Così chi ha il link e chiede il codice con la sua email non ottiene
 * niente sul negozio (secondo collaudo della sicurezza, 27/11), e la risposta è la stessa per qualunque email.
 * Tetto: 5 codici per indirizzo e 5 per link ogni 15 minuti.
 */

const Richiesta = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Scrivi un’email valida'),
  abbonamento: z.enum(ABBONAMENTI, { message: 'Scegli uno dei tre abbonamenti' }),
});

const QUARTO_D_ORA = 15 * 60_000;

export async function POST(req: Request, ctx: { params: Promise<{ codice: string }> }): Promise<NextResponse> {
  const { codice } = await ctx.params;
  if (!CODICE_VALIDO.test(codice)) return ApiErrors.notFound('Preventivo non trovato');
  const fuori = richiestaDalSito(req, '[preventivo-codice] richiesta del codice');
  if (fuori) return fuori;

  const perIndirizzo = await rateLimitAsync({ key: `preventivo-codice-email:${getClientIp(req)}`, max: 5, windowMs: QUARTO_D_ORA });
  if (!perIndirizzo.allowed) return ApiErrors.rateLimited(perIndirizzo.retryAfterSec);
  const perLink = await rateLimitAsync({ key: `preventivo-codice-email-link:${codice}`, max: 5, windowMs: QUARTO_D_ORA });
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
  const { email, abbonamento } = esito.data;

  let preventivo;
  try {
    preventivo = await leggiPreventivoColCodice(codice);
  } catch (errore) {
    logger.error('[preventivo-codice] lettura non riuscita (codice)', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il preventivo in questo momento. Riprova fra poco.');
  }
  if (!preventivo) return ApiErrors.notFound('Preventivo non trovato');
  if (preventivo.stato === 'accettato') return ApiErrors.conflict('Questo preventivo è già stato accettato: controlla la tua email per entrare.');
  if (preventivo.stato === 'chiuso') return ApiErrors.conflict('Questo preventivo non è più valido. Scrivici e te ne prepariamo uno nuovo.');

  const nuovo = creaCodice({ link: codice, email });
  if (!nuovo) {
    logger.error('[preventivo-codice] codice non creato: manca il segreto sul server');
    return ApiErrors.unavailable('Non riesco a mandarti il codice in questo momento. Riprova fra poco.');
  }
  const posta = codiceDelPreventivoTemplate({ negozio: preventivo.nomeAttivita, codice: nuovo.codice, abbonamento: FASCE[abbonamento].nome });
  const inviata = await sendEmail({ to: email, ...posta }).catch(() => ({ ok: false }));
  if (!inviata.ok) {
    logger.error('[preventivo-codice] codice non mandato', { sellerId: preventivo.sellerId });
    return ApiErrors.unavailable('Non sono riuscito a mandarti il codice. Riprova fra un momento.');
  }
  return NextResponse.json({ ok: true, data: { gettone: nuovo.gettone } }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
