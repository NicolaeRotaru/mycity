import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
  EXPERIMENT_LIST,
  assignVariant,
  resolveVariant,
  expCookieName,
  expHeaderName,
  EXP_COOKIE_MAX_AGE,
} from '@/lib/experiments';

/**
 * Middleware strict: il client browser usa @supabase/ssr, la sessione
 * viaggia nei cookie. Il middleware verifica il JWT lato server in
 * modo affidabile e fa tre cose:
 *
 *  1) Refresh dei cookie sessione se scaduti (chiamando getUser()).
 *  2) Enforcement delle aree role-protected (/admin, /seller, /rider):
 *     se l'utente non ha il ruolo giusto, redirect a /.
 *  3) Gate verifica email: se non confermata, redirect a /auth/verify-email.
 *  4) CSP nonce-per-request: genera nonce, applica CSP stretta con
 *     `nonce-XYZ` + `strict-dynamic`. Esperti consultati:
 *     - Security Engineer: "unsafe-inline + unsafe-eval su script-src e' una
 *       superficie XSS enorme. Nonce-based CSP nullifica injection di script
 *       inline non firmati."
 *     - Next.js docs: "App Router rispetta x-nonce header e lo propaga a tutti
 *       gli script Next inline (hydration, RSC payload, ecc.) automaticamente."
 */

const ROLE_PROTECTED: Array<{ prefix: string; allowed: ('admin' | 'seller' | 'rider')[] }> = [
  { prefix: '/admin',  allowed: ['admin'] },
  { prefix: '/seller', allowed: ['seller', 'admin'] },
  { prefix: '/rider',  allowed: ['rider', 'admin'] },
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function findRoleRule(pathname: string) {
  return ROLE_PROTECTED.find((r) => pathname.startsWith(r.prefix));
}

function getSupabaseHost(): string {
  try {
    return SUPABASE_URL ? new URL(SUPABASE_URL).host : '*.supabase.co';
  } catch {
    return '*.supabase.co';
  }
}

function buildCsp(nonce: string, isDev: boolean): string {
  const supaHost = getSupabaseHost();
  // In dev manteniamo unsafe-eval per webpack HMR + React fast refresh.
  // In prod usiamo nonce + strict-dynamic per la massima protezione XSS.
  const scriptSrc = isDev
    ? `'self' 'unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com https://*.posthog.com https://*.i.posthog.com https://*.sentry.io https://*.ingest.sentry.io`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com https://*.posthog.com https://*.i.posthog.com https://*.sentry.io https://*.ingest.sentry.io`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind + react-hook-form richiedono inline styles. Style-src e' meno
    // critico di script-src per XSS (style injection raramente exploitable).
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    `img-src 'self' data: blob: https://${supaHost} https://placehold.co https://api.dicebear.com https://api.iconify.design https://images.pexels.com https://*.tile.openstreetmap.org https://unpkg.com https://*.stripe.com https://www.google-analytics.com https://*.googletagmanager.com https://*.posthog.com`,
    "font-src 'self' data:",
    `connect-src 'self' https://${supaHost} wss://${supaHost} https://nominatim.openstreetmap.org https://challenges.cloudflare.com https://api.stripe.com https://www.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.posthog.com https://*.i.posthog.com https://*.sentry.io https://*.ingest.sentry.io`,
    "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com https://connect.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ');
}

function generateNonce(): string {
  // Web Crypto API (disponibile in edge runtime, no Node Buffer)
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CSP nonce: genera per ogni request, propaga via x-nonce header.
  // Next.js App Router rileva automaticamente x-nonce e applica nonce a
  // tutti gli script inline che genera (hydration, RSC, ecc.).
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = buildCsp(nonce, isDev);

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-nonce', nonce);

  // A/B testing: assegnazione stabile delle varianti. La variante esistente
  // (cookie) viene riusata; quella nuova viene generata, propagata al render
  // via header (corretta già al primo render, niente flicker) e persistita su
  // cookie nella response. Additivo: non tocca il routing né l'auth.
  const newAssignments: Array<{ cookie: string; variant: string }> = [];
  for (const exp of EXPERIMENT_LIST) {
    const existing = req.cookies.get(expCookieName(exp.key))?.value;
    if (existing) {
      reqHeaders.set(expHeaderName(exp.key), resolveVariant(exp, existing));
    } else {
      const variant = assignVariant(exp);
      reqHeaders.set(expHeaderName(exp.key), variant);
      if (exp.enabled) newAssignments.push({ cookie: expCookieName(exp.key), variant });
    }
  }

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  for (const a of newAssignments) {
    res.cookies.set({
      name: a.cookie,
      value: a.variant,
      maxAge: EXP_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
    });
  }

  // Perf: solo /admin, /seller, /rider richiedono sessione + ruolo. Per ogni
  // altra rotta (home, catalogo pubblico = ~90% del traffico) usciamo subito con
  // la sola CSP, evitando la round-trip auth a Supabase (getUser) ad ogni request.
  // Il refresh del cookie sessione sulle rotte pubbliche resta coperto dal client
  // supabase-js nel browser (auto-refresh) e dai server component su rotte protette.
  const roleRule = findRoleRule(pathname);
  if (!roleRule) return res;

  if (!SUPABASE_URL || !SUPABASE_KEY) return res;

  // Client server-side che legge/scrive cookie su richiesta+risposta.
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        req.cookies.set({ name, value, ...options });
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        req.cookies.set({ name, value: '', ...options });
        res.cookies.set({ name, value: '', ...options });
      },
    },
  });

  // Refresh sessione (best-effort)
  const { data: userResp } = await supabase.auth.getUser();
  const user = userResp?.user ?? null;

  // Helper: aggiunge CSP a una response redirect (mantiene protezione cross-cut).
  const withCsp = (r: NextResponse) => {
    r.headers.set('Content-Security-Policy', csp);
    return r;
  };

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('returnTo', pathname);
    return withCsp(NextResponse.redirect(url));
  }

  if (!user.email_confirmed_at) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/verify-email';
    return withCsp(NextResponse.redirect(url));
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_approved')
    .eq('id', user.id)
    .single();

  type ProfileRole = 'buyer' | 'seller' | 'rider' | 'admin';
  const role = profile?.role as ProfileRole | undefined;
  const approved = !!profile?.is_approved;

  if (!role || !roleRule.allowed.includes(role as ProfileRole & ('admin' | 'seller' | 'rider')) || !approved) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return withCsp(NextResponse.redirect(url));
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/|api/|favicon|icon-|manifest|sitemap|robots).*)',
  ],
};
