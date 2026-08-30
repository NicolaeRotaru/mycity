import { NextResponse, type NextRequest } from 'next/server';
import { SUPPORTED_LOCALES } from '@/i18n';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Setter del cookie locale.
 * POST /api/locale  body: { locale: 'it' | 'en' }
 *
 * Setta cookie NEXT_LOCALE (1 anno, HttpOnly=false perche' UI lo legge,
 * SameSite=Lax, Secure in prod). next-intl risolve il locale via i18n.ts
 * leggendo questo cookie.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { locale?: unknown };
  try {
    body = await jsonRichiesta(req, TETTO_JSON);
  } catch {
    // 27/8/2026 (R016) — DUE FORME DI ERRORE NELLO STESSO SITO. Il contratto e'
    // dichiarato in lib/api/responses.ts — `{ ok: false, error: { code,
    // message } }` — «cosi' il frontend sa esattamente cosa aspettarsi». Qui si
    // rispondeva `{ error: 'stringa' }`, e chi scrive una chiamata nuova la
    // legge nel modo sbagliato: l'errore vero non arriva a schermo e l'utente
    // vede «Operazione non riuscita» senza sapere perche'.
    return ApiErrors.invalidRequest('Invalid JSON');
  }

  const locale = typeof body.locale === 'string' ? body.locale : '';
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return ApiErrors.invalidRequest('Unsupported locale');
  }

  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set('NEXT_LOCALE', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
  });
  return res;
}
