import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { ABBONAMENTI } from '@/lib/agenzia/preventivo';
import { CODICE_VALIDO, leggiPreventivoColCodice, mandaCodiceDalLink } from '@/lib/agenzia/preventivo-col-codice';
import { richiestaDalSito } from '@/lib/agenzia/richiesta-dal-sito';

export const runtime = 'nodejs';

/**
 * IL TITOLARE CHIEDE IL CODICE PER CONFERMARE — 27/11/2026 (Nicola: «codice dall'email»).
 *
 * La pagina del link (app/preventivo/[codice]/page.tsx) manda la fascia scelta e l'email. Qui l'email va
 * sull'utente dell'attività e parte il codice (lib/agenzia/preventivo-col-codice.ts, `mandaCodiceDalLink`).
 * Il preventivo resta aperto: si accetta solo col codice giusto (../conferma). Si può chiedere di nuovo
 * («Rimanda il codice», o un'email corretta), con un tetto: 5 per indirizzo e 5 per link ogni 15 minuti.
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

  let preventivo;
  try {
    preventivo = await leggiPreventivoColCodice(codice);
  } catch (errore) {
    logger.error('[preventivo-codice] lettura non riuscita (codice)', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il preventivo in questo momento. Riprova fra poco.');
  }
  if (!preventivo) return ApiErrors.notFound('Preventivo non trovato');

  const mandato = await mandaCodiceDalLink({ preventivo, email: esito.data.email, fascia: esito.data.abbonamento });
  if (!mandato.ok) {
    if (mandato.motivo === 'GUASTO') return ApiErrors.unavailable(mandato.messaggio);
    return ApiErrors.conflict(mandato.messaggio);
  }
  return NextResponse.json({ ok: true, data: { inviato: true } }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
