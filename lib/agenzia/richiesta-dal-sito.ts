import type { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * LE PORTE DEL LINK COL CODICE ACCETTANO SOLO JSON PARTITO DAL SITO — 27/11/2026.
 *
 * Dal collaudo della sicurezza: la conferma apre una sessione, quindi una pagina di un altro sito non deve
 * poterla far partire dal browser di qualcuno. Due regole, le stesse per le tre porte del link
 * (accetta e codice):
 *  · se il browser dice da dove arriva la richiesta (Origin), deve essere il sito stesso: quello della
 *    richiesta o l'indirizzo pubblico del sito (come /auth/confirm). «null» non passa;
 *  · il corpo deve essere dichiarato JSON: un modulo «text/plain» di un altro sito non passa nemmeno la lettura.
 * Restituisce la risposta di rifiuto, o null se la richiesta può andare avanti.
 */
export function richiestaDalSito(req: Request, dove: string): NextResponse | null {
  const origine = req.headers.get('origin');
  if (origine && origine !== new URL(req.url).origin && origine !== new URL(env.appUrl()).origin) {
    logger.warn(`${dove}: richiesta arrivata da un altro sito`, { origine });
    return ApiErrors.forbidden('Richiesta non valida');
  }
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return ApiErrors.invalidRequest('Richiesta non valida');
  }
  return null;
}
