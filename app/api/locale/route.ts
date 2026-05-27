import { NextResponse, type NextRequest } from 'next/server';
import { SUPPORTED_LOCALES } from '@/i18n';

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
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const locale = typeof body.locale === 'string' ? body.locale : '';
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return NextResponse.json({ error: 'Unsupported locale' }, { status: 400 });
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
