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
  invalidRequest:  (message: string, details?: unknown) => apiError(400, message, 'INVALID_REQUEST', details),
  rateLimited:     (retryAfterSec: number) =>
    NextResponse.json(
      { ok: false, error: { code: 'RATE_LIMITED', message: `Troppe richieste. Riprova tra ${retryAfterSec}s.` } },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    ),
  internal:        (message = 'Errore interno') => apiError(500, message, 'INTERNAL'),
  unavailable:     (message = 'Servizio non configurato') => apiError(503, message, 'SERVICE_UNAVAILABLE'),
};
