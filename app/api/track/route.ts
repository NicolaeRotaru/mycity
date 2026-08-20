import { NextResponse } from 'next/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { getCurrentUser } from '@/lib/supabase/server';
import { recordActivity, type ActivityCategory } from '@/lib/activity';
import { parseUserAgent } from '@/lib/user-agent';
import { parseConsentCookie, CONSENT_COOKIE } from '@/lib/consent';
import { jsonConTetto } from '@/lib/api/corpo';

export const runtime = 'nodejs';

/**
 * Beacon di sorveglianza: riceve gli eventi del visitatore dal client
 * (components/ActivityTracker.tsx) e li registra in activity_events.
 *
 * Cattura l'IP e lo user-agent lato server (anche per i visitatori ANONIMI, non
 * loggati), associa l'utente se la sessione è presente, e mantiene un id
 * visitatore stabile nel cookie `mc_vid` per correlare le visite ricorrenti di
 * uno stesso anonimo (e collegarlo all'account quando fa login).
 *
 * Risponde sempre 204 (anche su errore/rate-limit): un beacon non deve mai
 * generare errori visibili o rumore in console.
 */

const VID_COOKIE = 'mc_vid';
const VID_MAX_AGE = 60 * 60 * 24 * 365; // 1 anno

const ALLOWED_EVENTS: Record<string, ActivityCategory> = {
  page_view: 'visitor',
  session_start: 'visitor',
  login: 'auth',
  logout: 'auth',
  signup: 'auth',
};

const SUMMARY: Record<string, (path?: string) => string> = {
  page_view: (p) => `Pagina vista: ${p || '/'}`,
  session_start: () => 'Nuova sessione avviata',
  login: () => 'Accesso effettuato',
  logout: () => 'Disconnessione',
  signup: () => 'Registrazione completata',
};

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * 025 — Solo le intestazioni che scrive DAVVERO l'infrastruttura davanti al sito
 * (Cloudflare, Vercel). `x-geo-country` e `x-geo-city` non le scrive nessuno qui:
 * le scriveva il chiamante, cioè chiunque, e finivano nella tabella come se
 * fossero un dato misurato. Un dato che si può dettare non è una misura.
 */
function geoFromHeaders(req: Request): { country: string | null; city: string | null } {
  const h = req.headers;
  const country = h.get('cf-ipcountry') || h.get('x-vercel-ip-country') || null;
  const city = h.get('cf-ipcity') || h.get('x-vercel-ip-city') || null;
  return {
    country: country && country !== 'XX' ? country.slice(0, 8) : null,
    city: city ? decodeURIComponent(city).slice(0, 80) : null,
  };
}

/**
 * 025 — `metadata` arrivava come oggetto libero e veniva salvato così com'è:
 * chiavi a piacere, valori a piacere, dimensione a piacere. Bastava un ciclo per
 * riempire la tabella di testo, e ogni lettore a valle si trovava una forma
 * diversa. Qui si accettano solo chiavi corte, valori semplici, e un tetto.
 */
const METADATA_MAX_CHIAVI = 20;
const METADATA_MAX_BYTE = 1024;

function metadataSicuro(input: unknown): Record<string, string | number | boolean> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const pulito: Record<string, string | number | boolean> = {};
  let chiavi = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (chiavi >= METADATA_MAX_CHIAVI) break;
    if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(k)) continue;
    if (typeof v === 'string') pulito[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) pulito[k] = v;
    else if (typeof v === 'boolean') pulito[k] = v;
    else continue;
    chiavi++;
  }
  if (chiavi === 0) return null;
  if (JSON.stringify(pulito).length > METADATA_MAX_BYTE) return null;
  return pulito;
}

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  const ip = getClientIp(request);

  // anti-flood: un client non deve poter riempire la tabella
  const rl = await rateLimitAsync({ key: `track:${ip}`, max: 120, windowMs: 60_000 });
  if (!rl.allowed) return noContent();

  let body: { event_type?: unknown; path?: unknown; referrer?: unknown; session_id?: unknown; metadata?: unknown };
  try {
    // #180 — Tetto vero: questa rotta e' pubblica e accetta JSON da chiunque.
    // Trentaduemila byte sono molto piu' di qualunque evento legittimo.
    const letto = await jsonConTetto(request, 32 * 1024);
    if (letto === undefined) return noContent(); // troppo grande: si scarta in silenzio
    body = letto as typeof body;
  } catch {
    return noContent();
  }

  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  const category = ALLOWED_EVENTS[eventType];
  if (!category) return noContent(); // tipo non in allowlist → ignora

  // 🟡-8: defense-in-depth GDPR. Gli eventi di analitica/sorveglianza ('visitor':
  // page_view, session_start) richiedono il consenso 'analytics' anche lato
  // server, non solo nel client. Gli eventi 'auth' (login/logout/signup) sono
  // funzionali/di sicurezza e non sono soggetti a consenso.
  const consent = parseConsentCookie(readCookie(request.headers.get('cookie'), CONSENT_COOKIE) ?? undefined);
  if (category === 'visitor' && !consent.analytics) return noContent();

  const path = typeof body.path === 'string' ? body.path.slice(0, 500) : null;
  const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : null;
  const sessionId = typeof body.session_id === 'string' ? body.session_id.slice(0, 100) : null;
  const metadata = metadataSicuro(body.metadata);

  const ua = request.headers.get('user-agent');
  const parsed = parseUserAgent(ua);
  const geo = geoFromHeaders(request);

  // id visitatore stabile (cookie di prima parte). Generato server-side e
  // mantenuto anche dopo il login → correla anonimo ↔ account.
  // Senza consenso all'analitica non si crea nessun identificatore persistente.
  // Prima il controllo copriva solo gli eventi di navigazione: quelli di accesso
  // (login, registrazione) proseguivano e piazzavano comunque il cookie mc_vid
  // per un anno, che e' esattamente cio' a cui la persona aveva detto no.
  // L'evento di sicurezza resta registrato, ma senza etichetta che segua.
  let vid = consent.analytics
    ? readCookie(request.headers.get('cookie'), VID_COOKIE)
    : null;
  let setCookie = false;
  if (!vid && consent.analytics) {
    vid = crypto.randomUUID();
    setCookie = true;
  }

  // associa l'utente loggato (il beacon manda i cookie di sessione)
  let userId: string | null = null;
  try {
    const user = await getCurrentUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  await recordActivity({
    category,
    eventType,
    summary: (SUMMARY[eventType] ?? (() => eventType))(path ?? undefined),
    actorId: userId,
    userId,
    anonId: vid,
    sessionId,
    path,
    referrer,
    ip,
    userAgent: ua,
    deviceType: parsed.deviceType,
    browser: parsed.browser,
    os: parsed.os,
    country: geo.country,
    city: geo.city,
    isBot: parsed.isBot,
    metadata,
  });

  const res = noContent();
  if (setCookie && vid) {
    res.cookies.set({
      name: VID_COOKIE,
      value: vid,
      maxAge: VID_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
    });
  }
  return res;
}
