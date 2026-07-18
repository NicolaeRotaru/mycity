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
import {
  EXIT_SHOPPING_QUERY,
  SHOPPING_MODE_COOKIE,
  SHOPPING_MODE_MAX_AGE,
  SHOPPING_MODE_QUERY,
  isMarketplaceBrowsePath,
  sellerMayBrowseMarketplace,
} from '@/lib/shopping-access';

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

// Rotte che richiedono solo l'autenticazione (qualsiasi ruolo), non un ruolo
// specifico. 🟠-18: /profile/** era senza guard server-side (protezione
// per-pagina incoerente). Qui la centralizziamo con returnTo preciso.
const AUTH_REQUIRED = ['/profile'];

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
    `img-src 'self' data: blob: https://${supaHost} https://placehold.co https://api.iconify.design https://images.pexels.com https://*.tile.openstreetmap.org https://unpkg.com https://*.stripe.com https://www.google-analytics.com https://*.googletagmanager.com https://*.posthog.com`,
    "font-src 'self' data:",
    // <video srcObject=MediaStream> per la fotocamera in-app, blob URL anteprime,
    // e i video MP4 self-hosted della home (Supabase Storage).
    `media-src 'self' blob: https://${supaHost}`,
    // 🟠-15: nominatim rimosso — il geocoding ora passa dal proxy server-side
    // (/api/geocode), il browser non chiama più direttamente Nominatim.
    `connect-src 'self' https://${supaHost} wss://${supaHost} https://challenges.cloudflare.com https://api.stripe.com https://www.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.posthog.com https://*.i.posthog.com https://*.sentry.io https://*.ingest.sentry.io`,
    // youtube-nocookie + vimeo: embed del blocco "video" della vetrina (VideoSection).
    "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com https://connect.stripe.com https://www.youtube-nocookie.com https://player.vimeo.com",
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

  // Uscita esplicita dalla modalità acquisto venditore.
  if (req.nextUrl.searchParams.get(EXIT_SHOPPING_QUERY) === '1') {
    const url = req.nextUrl.clone();
    url.pathname = '/seller/dashboard';
    url.searchParams.delete(EXIT_SHOPPING_QUERY);
    const exitRes = NextResponse.redirect(url);
    exitRes.headers.set('Content-Security-Policy', csp);
    exitRes.cookies.set({
      name: SHOPPING_MODE_COOKIE,
      value: '',
      maxAge: 0,
      path: '/',
    });
    return exitRes;
  }

  const roleRule = findRoleRule(pathname);
  const needsAuth = !!roleRule || AUTH_REQUIRED.some((p) => pathname.startsWith(p));
  const needsSellerGate = isMarketplaceBrowsePath(pathname);

  // Perf: la maggior parte del traffico pubblico esce subito (solo CSP).
  // Eccezione: venditori loggati sul catalogo → gate modalità acquisto.
  if (!needsAuth && !needsSellerGate) return res;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Fail-closed: se mancano le env Supabase, blocca le rotte protette invece di lasciarle passare.
    if (needsAuth) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      const r = NextResponse.redirect(url);
      r.headers.set('Content-Security-Policy', csp);
      return r;
    }
    return res;
  }

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
    // Catalogo pubblico: ospiti ok. Solo le rotte protette richiedono login.
    if (!needsAuth) return res;
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

  // Entrata modalità acquisto venditore (?shop=1 dal pulsante SellerShell).
  if (role === 'seller' && req.nextUrl.searchParams.get(SHOPPING_MODE_QUERY) === '1') {
    const cookieOpts = {
      name: SHOPPING_MODE_COOKIE,
      value: '1',
      maxAge: SHOPPING_MODE_MAX_AGE,
      path: '/',
      sameSite: 'lax' as const,
    };
    if (isMarketplaceBrowsePath(pathname)) {
      const url = req.nextUrl.clone();
      url.searchParams.delete(SHOPPING_MODE_QUERY);
      const enterRes = NextResponse.redirect(url);
      enterRes.headers.set('Content-Security-Policy', csp);
      enterRes.cookies.set(cookieOpts);
      return enterRes;
    }
    res.cookies.set(cookieOpts);
  }

  // Venditori: catalogo/acquisto solo con cookie modalità (pulsante dedicato).
  if (role === 'seller' && needsSellerGate) {
    const hasShoppingMode = req.cookies.get(SHOPPING_MODE_COOKIE)?.value === '1';
    if (!sellerMayBrowseMarketplace(hasShoppingMode)) {
      const url = req.nextUrl.clone();
      url.pathname = '/seller/dashboard';
      return withCsp(NextResponse.redirect(url));
    }
  }

  // Il role-check si applica SOLO alle rotte role-protected (/admin,/seller,/rider).
  // Per le rotte solo-auth (/profile) basta l'utente autenticato verificato sopra.
  if (roleRule) {
    if (!role || !roleRule.allowed.includes(role as ProfileRole & ('admin' | 'seller' | 'rider')) || !approved) {
      const url = req.nextUrl.clone();
      // Buyer/rider fuori posto → home. Seller fuori posto → dashboard (non marketplace).
      url.pathname = role === 'seller' ? '/seller/dashboard' : '/';
      return withCsp(NextResponse.redirect(url));
    }
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/|api/|favicon|icon-|manifest|sitemap|robots).*)',
  ],
};
