import { NextResponse } from 'next/server';

/**
 * Helpers per response API uniformi.
 *
 * Esperti consultati:
 * - Backend Engineer: "Response shape mai inconsistente. Frontend deve sapere
 *   esattamente cosa aspettarsi: { ok: true, data } vs { ok: false, error }."
 * - TypeScript Specialist: "ApiResponse<T> discriminated union → frontend
 *   if (res.ok) { res.data } else { res.error.message }."
 */

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError       = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

/**
 * S10 (5/11/2026) — Molte rotte passano come `details` il messaggio intero
 * dell'errore (`e instanceof Error ? e.message : undefined`). Con zod quel
 * messaggio e' l'elenco grezzo in JSON di tutti i controlli falliti, coi nomi
 * interni dei campi; con altre librerie e' il loro testo interno. Al browser
 * arriva solo il primo problema leggibile, `{ campo, messaggio }`; un testo
 * qualunque non arriva. Gli oggetti costruiti apposta dalla rotta passano.
 */
export function dettagliLeggibili(details: unknown): unknown {
  if (typeof details !== 'string') return details;
  try {
    const elenco = JSON.parse(details) as unknown;
    if (Array.isArray(elenco) && elenco.length > 0) {
      const primo = elenco[0] as { path?: unknown; message?: unknown };
      if (typeof primo?.message === 'string') {
        const campo = Array.isArray(primo.path) ? primo.path.map(String).join('.') : '';
        return { campo, messaggio: primo.message };
      }
    }
  } catch {
    // non e' un elenco di zod: e' un testo interno, e non esce.
  }
  return undefined;
}

export function apiError(
  status: number,
  message: string,
  code?: string,
  details?: unknown,
): NextResponse<ApiError> {
  const errorCode = code ?? `HTTP_${status}`;
  return NextResponse.json(
    { ok: false, error: { code: errorCode, message, details } },
    { status },
  );
}

export const ApiErrors = {
  unauthorized:    (message = 'Autenticazione richiesta') => apiError(401, message, 'UNAUTHORIZED'),
  forbidden:       (message = 'Non hai i permessi per questa azione') => apiError(403, message, 'FORBIDDEN'),
  notFound:        (message = 'Non trovato') => apiError(404, message, 'NOT_FOUND'),
  invalidRequest:  (message: string, details?: unknown) => apiError(400, message, 'INVALID_REQUEST', dettagliLeggibili(details)),
  rateLimited:     (retryAfterSec: number, message?: string) =>
    NextResponse.json(
      { ok: false, error: { code: 'RATE_LIMITED', message: message ?? `Troppe richieste. Riprova tra ${retryAfterSec}s.` } },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    ),
  conflict:        (message: string) => apiError(409, message, 'CONFLICT'),
  payloadTooLarge: (message: string) => apiError(413, message, 'PAYLOAD_TOO_LARGE'),
  badGateway:      (message: string) => apiError(502, message, 'BAD_GATEWAY'),
  internal:        (message = 'Errore interno') => apiError(500, message, 'INTERNAL'),
  unavailable:     (message = 'Servizio non configurato') => apiError(503, message, 'SERVICE_UNAVAILABLE'),
};
