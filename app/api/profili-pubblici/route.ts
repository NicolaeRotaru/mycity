import { getAdminSupabase } from '@/lib/supabase/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { apiSuccess, ApiErrors } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { idDaChiedere, leggiHandlePubblici } from '@/lib/queries/profili-pubblici';

/**
 * GLI HANDLE PUBBLICI DI CHI HA CREATO UNA LISTA — SOLA LETTURA.
 *
 * 18/10/2026 — Le liste curate chiedevano l'autore alla tabella dei profili dal browser. Dopo le
 * migrazioni 110 e 161 il browser legge solo la propria riga, e le liste avrebbero perso «@handle».
 * Qui il server legge col client di servizio e restituisce, per gli id chiesti, SOLO id e handle
 * di chi ha acceso il profilo pubblico. Cosa espone e perche' e' scritto in
 * `lib/queries/profili-pubblici.ts`.
 *
 * Senza account, come le pagine delle liste. Il freno per indirizzo tiene lontano chi prova a
 * chiedere id a raffica.
 */
export async function GET(req: Request) {
  const freno = await rateLimitAsync({ key: `profili-pubblici:${getClientIp(req)}`, max: 120, windowMs: 60_000 });
  if (!freno.allowed) return ApiErrors.rateLimited(freno.retryAfterSec);

  const ids = idDaChiedere(new URL(req.url).searchParams.getAll('id'));
  if (!ids) return ApiErrors.invalidRequest('Servono da 1 a 50 id di persona, scritti per intero.');

  try {
    return apiSuccess(await leggiHandlePubblici(getAdminSupabase(), ids));
  } catch (e) {
    logger.error('[api/profili-pubblici] lettura non riuscita', e);
    return ApiErrors.internal('Gli autori delle liste non si sono potuti leggere. Riprova fra poco.');
  }
}
