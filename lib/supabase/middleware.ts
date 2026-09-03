import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { parseConsentCookie, CONSENT_COOKIE } from '@/lib/consent';
import { logger } from '@/lib/logger';
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
import {
  type Risposta,
  TETTO_PORTIERE_MS,
  chiediConTetto,
  comeStaIlFornitore,
  decidiCacheProfilo,
  decidiPortiere,
  motivoLeggibile,
} from '@/lib/auth/decisione-portiere';

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

type ProfiloInCache = { role: string | undefined; approved: boolean; emailConfermata: boolean };

/**
 * 30/8/2026 (R072) — L'IMPRONTA DELLA SESSIONE, PERCHE' IL COOKIE SI POSSA
 * LEGGERE PRIMA DI SAPERE CHI E'.
 *
 * Il cookie del ruolo portava dentro l'id della persona e si confrontava con
 * quello restituito da `getUser()`. Ma `getUser()` e' proprio la chiamata di
 * rete che si vuole evitare sul catalogo: finche' il confronto dipende da lei,
 * il cookie serve solo a risparmiare la SECONDA attesa, non la prima.
 *
 * Qui il legame diventa la sessione stessa: i cookie `sb-…-auth-token` SONO la
 * credenziale, e un'impronta del loro contenuto cambia quando cambia la
 * persona (o quando il gettone viene rinnovato). Il cookie del ruolo resta
 * firmato da noi e httpOnly: l'impronta sta DENTRO il dato firmato, quindi non
 * la si puo' rifare a mano. Se non combacia, il cookie non vale e si torna a
 * chiedere — cioe' si perde una scorciatoia, mai un controllo.
 *
 * Non e' una funzione di sicurezza: e' un modo di dire «questo cookie parla di
 * questa sessione». Un'impronta veloce basta e avanza.
 */
function improntaSessione(req: NextRequest): string {
  const pezzi: string[] = [];
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-') && c.name.includes('-auth-token')) pezzi.push(`${c.name}=${c.value}`);
  }
  // Nessuna sessione: nessuna impronta. Vuoto e' «non lo so», e chi chiama
  // ripiega — non su un valore uguale per tutti, che sarebbe peggio di niente.
  if (pezzi.length === 0) return '';
  pezzi.sort();
  let h = 0x811c9dc5;
  const testo = pezzi.join('&');
  for (let i = 0; i < testo.length; i++) {
    h ^= testo.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Il profilo messo da parte, se il cookie e' nostro ED e' di questa sessione.
 * Con `userId` si controlla anche che parli di quella persona: serve dopo
 * `getUser()`, dove l'id vero c'e'.
 */
async function leggiRuoloDalCookie(
  req: NextRequest,
  userId?: string,
): Promise<ProfiloInCache | null> {
  const segreto = segretoRuolo();
  if (!segreto) return null;
  const grezzo = req.cookies.get(RUOLO_COOKIE)?.value;
  if (!grezzo) return null;
  const [dato, firma] = grezzo.split('.');
  if (!dato || !firma) return null;
  const [id, ruolo, approvato, emailOk, impronta] = dato.split('|');
  // I cookie scritti prima di questa versione non portano l'impronta: valgono
  // come «non c'e' niente da riusare», e si rilegge il profilo vero.
  if (!impronta || impronta !== improntaSessione(req)) return null;
  if (userId !== undefined && id !== userId) return null;
  if ((await firmaRuolo(dato, segreto)) !== firma) return null;
  return { role: ruolo || undefined, approved: approvato === '1', emailConfermata: emailOk === '1' };
}

async function scriviRuoloNelCookie(
  req: NextRequest,
  res: NextResponse,
  userId: string,
  profilo: ProfiloInCache,
): Promise<void> {
  const segreto = segretoRuolo();
  if (!segreto) return;
  const dato = [
    userId,
    profilo.role ?? '',
    profilo.approved ? '1' : '0',
    profilo.emailConfermata ? '1' : '0',
    improntaSessione(req),
  ].join('|');
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
  /**
   * 30/8/2026 (R173) — Il seme dell'assegnazione: qualcosa che c'e' gia' e che
   * non cambia da una pagina all'altra. Prima la sessione (se c'e'), poi
   * indirizzo di rete + browser. Non si scrive niente sul dispositivo e non si
   * conserva niente: serve solo a far uscire lo stesso numero due volte di
   * seguito, cosi' chi non ha accettato i cookie non vede la home cambiare
   * faccia a ogni click.
   */
  const semeStabile =
    improntaSessione(req) ||
    `${req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? ''}|${req.headers.get('user-agent') ?? ''}`;
  for (const exp of EXPERIMENT_LIST) {
    const existing = req.cookies.get(expCookieName(exp.key))?.value;
    if (existing) {
      reqHeaders.set(expHeaderName(exp.key), resolveVariant(exp, existing));
    } else {
      const variant = assignVariant(exp, semeStabile);
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

  /**
   * 30/8/2026 (R072) — IL CATALOGO NON ASPETTA PIU' IL SERVIZIO DI ACCESSO.
   *
   * Su queste pagine — home, prodotto, negozio, carrello, cassa, ricerca — al
   * middleware serve UNA cosa sola: sapere se chi guarda e' un venditore, per
   * mandarlo al suo pannello invece che a fare la spesa. Quel dato sta nel
   * cookie firmato, e si leggeva DOPO `getUser()`, cioe' dopo aver pagato un
   * giro di rete fino a Supabase davanti al primo byte di ogni click.
   *
   * Adesso si guarda prima. Chi non e' venditore passa senza toccare la rete;
   * il venditore, chi ha il cookie scaduto o di un'altra sessione, e chiunque
   * si trovi su una pagina protetta, fanno la strada intera di sempre.
   */
  if (!needsAuth && needsSellerGate) {
    const messoDaParte = await leggiRuoloDalCookie(req);
    if (messoDaParte && messoDaParte.emailConfermata && messoDaParte.role !== 'seller') {
      return res;
    }
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
  //
  // 27/8/2026 (R185) — «NON E' ENTRATO NESSUNO» E «NON HO POTUTO CHIEDERE»
  // NON SONO LA STESSA COSA.
  //
  // 3/9/2026 — E NESSUNO DEI DUE PUO' DURARE PER SEMPRE.
  //
  // L'errore veniva buttato via e i due casi finivano nello stesso ramo (R185
  // ha rimesso a posto la riga di log). Restava il resto: nessun tetto di
  // tempo — trenta secondi lenti del fornitore erano trenta secondi di pagina
  // appesa — e nessuna decisione scritta da qualche parte. Adesso l'attesa ha
  // un tetto e la scelta sta in `decidiPortiere`, che si puo' provare da sola.
  /**
   * CHI SE NE ACCORGE, E COME.
   *
   * Un fornitore lento e' un avviso: durante un intoppo ne escono a migliaia,
   * e mille eventi identici dentro Sentry spengono quelli veri. Una chiamata
   * che invece SCOPPIA e' un guasto nostro, e prima di questo tetto di tempo
   * arrivava a Sentry da sola (come errore del middleware): adesso che la
   * fermiamo qui, deve arrivarci lo stesso, o l'avremmo solo nascosta meglio.
   */
  const registraGuasto = (messaggio: string, risposta: Risposta<{ error?: unknown }>) => {
    const contesto = { percorso: pathname, motivo: motivoLeggibile(risposta), messaggio };
    if (risposta.stato === 'rotto') logger.error(risposta.errore, contesto);
    else logger.warn(messaggio, contesto);
  };

  const rispostaUtente = await chiediConTetto(() => supabase.auth.getUser(), TETTO_PORTIERE_MS);
  const user = rispostaUtente.stato === 'ok' ? (rispostaUtente.valore.data?.user ?? null) : null;
  const decisione = decidiPortiere({
    fornitore: comeStaIlFornitore(rispostaUtente),
    utenteTrovato: !!user,
    areaProtetta: needsAuth,
  });
  if (decisione.registra) registraGuasto(decisione.registra, rispostaUtente);

  // Helper: aggiunge CSP a una response redirect (mantiene protezione cross-cut).
  const withCsp = (r: NextResponse) => {
    r.headers.set('Content-Security-Policy', csp);
    return r;
  };

  if (decisione.azione === 'chiudi-al-login') {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('returnTo', pathname);
    return withCsp(NextResponse.redirect(url));
  }
  // «Tira dritto come ospite»: il catalogo si vede anche quando il servizio di
  // accesso non risponde. Senza una persona verificata non c'e' altro da fare.
  if (decisione.azione === 'passa-come-ospite' || !user) return res;

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
    // 27/8/2026 (R185) — UN SECONDO STORTO DEL DATABASE DURAVA DIECI MINUTI.
    //
    // L'errore non veniva guardato. Se la lettura falliva, da `profile` vuoto
    // usciva «ruolo: nessuno, approvato: no» — e quella risposta finiva nel
    // cookie firmato, che vale dieci minuti. Un venditore approvato diventava
    // uno sconosciuto fuori dal suo pannello per i dieci minuti successivi,
    // anche dopo che il database era gia' tornato a posto.
    //
    // 3/9/2026 — E anche questa attesa ha un tetto: era la seconda delle due
    // che si mettevano in fila davanti a ogni pagina, e nessuna delle due
    // finiva mai da sola. Scaduta o rotta vale come «non ho potuto chiedere»:
    // si riprova alla pagina dopo, e intanto non si mette niente da parte.
    const rispostaProfilo = await chiediConTetto(
      () =>
        supabase
          .from('profiles')
          .select('role, is_approved')
          .eq('id', user.id)
          .single(),
      TETTO_PORTIERE_MS,
    );
    const profile = rispostaProfilo.stato === 'ok' ? rispostaProfilo.valore.data : null;
    profilo = {
      role: profile?.role as ProfileRole | undefined,
      approved: !!profile?.is_approved,
      // Serve alla scorciatoia del catalogo: senza, un cookie scritto prima
      // della conferma dell'email lascerebbe scavalcare quel cancello.
      emailConfermata: true,
    };
    const suProfilo = decidiCacheProfilo(rispostaProfilo);
    if (suProfilo.registra) registraGuasto(suProfilo.registra, rispostaProfilo);
    daSalvare = suProfilo.mettiInCache && decisione.scriviCookieRuolo;
  }
  const role = profilo.role as ProfileRole | undefined;
  const approved = profilo.approved;
  if (daSalvare) await scriviRuoloNelCookie(req, res, user.id, profilo);

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
