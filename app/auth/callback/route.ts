import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env, requireSupabasePublic } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Callback PKCE / OAuth / email confirmation.
 * Supabase Auth invia gli utenti qui dopo:
 *  - conferma email registrazione
 *  - reset password
 *  - login via provider OAuth (se configurato)
 *
 * Scambia il `code` con una sessione e setta i cookie httpOnly via
 * @supabase/ssr. Poi redirect a `next` (sanificato) o a `/`.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') ?? '/';
  // Sanitize: solo path interni
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  if (!code) {
    return NextResponse.redirect(new URL('/sign-in?error=missing_code', env.appUrl()));
  }

  const { url: supaUrl, key: supaKey } = requireSupabasePublic();
  const res = NextResponse.redirect(new URL(next, env.appUrl()));

  const supabase = createServerClient(supaUrl, supaKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        res.cookies.set({ name, value: '', ...options });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/sign-in?error=callback_failed', env.appUrl()));
  }

  return res;
}
