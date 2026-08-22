import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { parseConsentCookie, CONSENT_COOKIE } from '@/lib/consent';
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

/**
 * 086 — C'È UNA SESSIONE, O È UN VISITATORE QUALUNQUE?
 *
 * La sessione Supabase vive nei cookie: si chiamano `sb-<progetto>-auth-token`
 * (a volte spezzati in `.0`, `.1` quando sono lunghi). Se non ce n'è nessuno,
 * non c'è niente da verificare — e si può uscire senza nemmeno costruire il
 * client Supabase.
 *
 * Perché conta: la scorciatoia scritta poco più sotto («la maggior parte del
 * traffico pubblico esce subito») non scattava mai sul catalogo, perché il
 * gate dei venditori si applica proprio a tutte le pagine che contano — home,
 * prodotto, negozio, carrello, ricerca. Quindi per ogni visitatore, crawler
 * compreso, si costruiva un client Supabase per niente.
 */
function haCookieDiSessione(req: NextRequest): boolean {
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-') && c.name.includes('-auth-token')) return true;
  }
  return false;
}

/**
 * 086 — RUOLO E APPROVAZIONE, RILETTI UNA VOLTA OGNI DIECI MINUTI.
 *
 * Per chi ha fatto l'accesso partivano DUE attese di rete infilate davanti a
 * ogni pagina: la verifica del token (che va davvero a chiedere a Supabase) e
 * subito dopo una SELECT su `profiles`. Su ogni passaggio di pagina, home
 * compresa. Ed è la persona che compra: quella che aspetta di più è quella
 * che ci porta i soldi.
 *
 * Il ruolo si mette quindi in un cookie firmato che dura dieci minuti. Firmato
 * e non semplice, perché un cookie che il browser può riscrivere non è una
 * fonte su cui decidere.
 *
 * ⚠️ IL LIMITE, DICHIARATO: questa scorciatoia vale SOLO per il gate dei
 * venditori sul catalogo. Le aree protette — /admin, /seller, /rider —
 * rileggono sempre il profilo vero, perché su quelle un ruolo vecchio di
 * dieci minuti vorrebbe dire lasciare dentro qualcuno che è appena stato
 * tolto. Comodità sul catalogo, verità sui permessi.
 */
const RUOLO_COOKIE = 'mc_ruolo';
const RUOLO_COOKIE_MAX_AGE = 10 * 60;

/**
 * 22/8/2026 — IL COOKIE DEL RUOLO ERA FIRMATO CON LA CHIAVE DELLE DISISCRIZIONI.
 *
 * C'era un ripiego su `UNSUBSCRIBE_SECRET`, e non era teorico: la variabile
 * giusta non compariva né in `.env.example` né in `render.yaml`, quindi il
 * ripiego era la strada che girava davvero. La stessa chiave firmava così due
 * cose diverse: il cookie che porta ruolo e stato di approvazione di una
 * persona, e i link di disiscrizione presenti in fondo a ogni email spedita.
 *
 * Una chiave che esce in ogni email non è più un segreto. E una chiave sola per
 * due scopi vuol dire che chi ne conosce uno può falsificare l'altro.
 *
 * Il ripiego è sparito. Con `null` il codice si comporta già bene da solo:
 * rilegge il profilo dal database, che è la verità — perde solo la comodità
 * della cache.
 */
function segretoRuolo(): string | null {
  return process.env.MIDDLEWARE_CACHE_SECRET || null;
}

async function firmaRuolo(dato: string, segreto: string): Promise<string> {
  const chiave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign('HMAC', chiave, new TextEncoder().encode(dato));
  return btoa(String.fromCharCode(...new Uint8Array(firma)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type ProfiloInCache = { role: string | undefined; approved: boolean };

async function leggiRuoloDalCookie(
  req: NextRequest,
  userId: string,
): Promise<ProfiloInCache | null> {
  const segreto = segretoRuolo();
  if (!segreto) return null;
  const grezzo = req.cookies.get(RUOLO_COOKIE)?.value;
  if (!grezzo) return null;
  const [dato, firma] = grezzo.split('.');
  if (!dato || !firma) return null;
  // Il dato porta dentro l'id della persona: un cookie di qualcun altro non vale.
  const [id, ruolo, approvato] = dato.split('|');
  if (id !== userId) return null;
  if ((await firmaRuolo(dato, segreto)) !== firma) return null;
  return { role: ruolo || undefined, approved: approvato === '1' };
}

async function scriviRuoloNelCookie(
  res: NextResponse,
  userId: string,
  profilo: ProfiloInCache,
): Promise<void> {
  const segreto = segretoRuolo();
  if (!segreto) return;
  const dato = `${userId}|${profilo.role ?? ''}|${profilo.approved ? '1' : '0'}`;
  res.cookies.set({
    name: RUOLO_COOKIE,
    value: `${dato}.${await firmaRuolo(dato, segreto)}`,
    maxAge: RUOLO_COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
  });
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
    // #76 — unpkg.com non serve piu': le icone della mappa stanno in /public e
    // il foglio di stile di Leaflet e' compilato dentro il sito. Un permesso in
    // meno nella politica di sicurezza e' un posto in meno da cui puo' arrivare
    // codice, e un destinatario in meno da dichiarare nell'informativa.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://${supaHost} https://placehold.co https://api.iconify.design https://images.pexels.com https://*.tile.openstreetmap.org https://*.stripe.com https://www.google-analytics.com https://*.googletagmanager.com https://*.posthog.com`,
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
  // #74 — Il cookie della prova A/B dura novanta giorni e serve a riconoscere
  // lo stesso browser fra una visita e l'altra: e' un cookie di analisi, non
  // tecnico, e va sotto lo stesso consenso di tutti gli altri. Senza consenso
  // la variante si sceglie lo stesso — la pagina deve pur mostrare qualcosa —
  // ma non si scrive niente sul dispositivo, e alla visita dopo si riparte.
  const consensoAnalitico = parseConsentCookie(req.cookies.get(CONSENT_COOKIE)?.value).analytics;
  const newAssignments: Array<{ cookie: string; variant: string }> = [];
  for (const exp of EXPERIMENT_LIST) {
    const existing = req.cookies.get(expCookieName(exp.key))?.value;
    if (existing) {
      reqHeaders.set(expHeaderName(exp.key), resolveVariant(exp, existing));
    } else {
      const variant = assignVariant(exp);
      reqHeaders.set(expHeaderName(exp.key), variant);
      if (exp.enabled && consensoAnalitico) newAssignments.push({ cookie: expCookieName(exp.key), variant });
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

  // 086 — Senza cookie di sessione non c'è niente da verificare: non si
  // costruisce nemmeno il client Supabase. È il caso di ogni visitatore
  // anonimo e di ogni crawler, cioè della maggior parte del traffico sul
  // catalogo — dove la scorciatoia qui sopra non scatta mai, perché il gate
  // dei venditori copre tutte le pagine che contano.
  if (!haCookieDiSessione(req)) {
    if (!needsAuth) return res;
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('returnTo', pathname);
    const r = NextResponse.redirect(url);
    r.headers.set('Content-Security-Policy', csp);
    return r;
  }

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

  type ProfileRole = 'buyer' | 'seller' | 'rider' | 'admin';

  // 086 — Sulle aree protette il profilo si rilegge SEMPRE: un ruolo vecchio
  // di dieci minuti lascerebbe dentro qualcuno appena tolto. Sul catalogo
  // invece basta sapere se è un venditore, e quello può aspettare.
  let profilo = roleRule ? null : await leggiRuoloDalCookie(req, user.id);
  let daSalvare = false;
  if (!profilo) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_approved')
      .eq('id', user.id)
      .single();
    profilo = {
      role: profile?.role as ProfileRole | undefined,
      approved: !!profile?.is_approved,
    };
    daSalvare = true;
  }
  const role = profilo.role as ProfileRole | undefined;
  const approved = profilo.approved;
  if (daSalvare) await scriviRuoloNelCookie(res, user.id, profilo);

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
