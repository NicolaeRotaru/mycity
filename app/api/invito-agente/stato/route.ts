import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { CODICE_INVITO, leggiInvito, statoInvito } from '@/lib/agenti/inviti';

export const runtime = 'nodejs';

/**
 * IL LINK D'INVITO VALE ANCORA? — 26/11/2026 (migrazione 865).
 * La pagina /invito-agente legge il codice dopo il «#» e lo chiede qui, nel corpo della richiesta: così il
 * codice non sta mai in un indirizzo e non finisce nei registri. Risponde solo lo stato, mai i dettagli.
 */
const Richiesta = z.object({ codice: z.string().regex(CODICE_INVITO) });

export async function POST(req: Request): Promise<NextResponse> {
  const rl = await rateLimitAsync({ key: `invito-agente-stato:${getClientIp(req)}`, max: 30, windowMs: 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  const nessunaCache = { 'Cache-Control': 'no-store' };
  if (!esito.success) return NextResponse.json({ ok: true, data: { stato: 'inesistente' } }, { headers: nessunaCache });
  try {
    const stato = statoInvito(await leggiInvito(esito.data.codice));
    return NextResponse.json({ ok: true, data: { stato } }, { headers: nessunaCache });
  } catch (errore) {
    logger.error('[invito-agente] stato non letto', { errore: String(errore) });
    return ApiErrors.unavailable('Non riesco a leggere il link in questo momento. Riprova fra poco.');
  }
}
