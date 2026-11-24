import type { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { segretiCombaciano } from '@/lib/api/segreti';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';

/**
 * UNA PORTA CHIUSA DA UN SEGRETO — 24/11/2026.
 *
 * Le porte da cui altri programmi nostri parlano col sito (n8n per l'analisi dei canali, l'AD per la
 * bozza del sito) hanno le stesse tre regole della scheda del cliente (app/api/agenzia/scheda-cliente):
 *  · senza segreto configurato la porta resta chiusa (503), mai aperta per sbaglio;
 *  · solo https, tranne sul computer di prova;
 *  · il segreto nell'intestazione `x-mycity-segreto`, confrontato senza dire quanti caratteri tornano;
 *  · un tetto di richieste per indirizzo, prima di guardare il segreto (chi prova a indovinarlo si ferma).
 * Risponde `null` se si entra, altrimenti la risposta d'errore da restituire.
 */

export const INTESTAZIONE_SEGRETO = 'x-mycity-segreto';

export function arrivaInHttps(req: Request): boolean {
  const url = new URL(req.url);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return (proto ?? url.protocol.replace(':', '')) === 'https';
}

export async function portaColSegreto(
  req: Request,
  opzioni: { segreto: string | undefined; nome: string; max?: number; finestraMs?: number },
): Promise<NextResponse | null> {
  const segreto = opzioni.segreto?.trim();
  if (!segreto) return ApiErrors.unavailable('Questa porta non è ancora collegata.');
  if (!arrivaInHttps(req)) return ApiErrors.forbidden('Solo https.');
  const rl = await rateLimitAsync({ key: `${opzioni.nome}:${getClientIp(req)}`, max: opzioni.max ?? 60, windowMs: opzioni.finestraMs ?? 10 * 60_000 });
  if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
  if (!segretiCombaciano(req.headers.get(INTESTAZIONE_SEGRETO)?.trim(), segreto)) return ApiErrors.unauthorized();
  return null;
}
