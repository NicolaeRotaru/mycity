import { NextResponse } from 'next/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { getCurrentUser } from '@/lib/supabase/server';
import { recordActivity, type ActivityCategory } from '@/lib/activity';
import { parseUserAgent } from '@/lib/user-agent';

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

function geoFromHeaders(req: Request): { country: string | null; city: string | null } {
  const h = req.headers;
  const country =
    h.get('cf-ipcountry') || h.get('x-vercel-ip-country') || h.get('x-geo-country') || null;
  const city =
    h.get('x-vercel-ip-city') || h.get('x-geo-city') || null;
  return {
    country: country && country !== 'XX' ? country : null,
    city: city ? decodeURIComponent(city) : null,
  };
}

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  const ip = getClientIp(request);

  // anti-flood: un client non deve poter riempire la tabella
  const rl = await rateLimitAsync({ key: `track:${ip}`, max: 120, windowMs: 60_000 });
  if (!rl.allowed) return noContent();

  let body: { event_type?: unknown; path?: unknown; referrer?: unknown; session_id?: unknown; metadata?: unknown };
  try {
    body = await request.json();
  } catch {
    return noContent();
  }

  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  const category = ALLOWED_EVENTS[eventType];
  if (!category) return noContent(); // tipo non in allowlist → ignora

  const path = typeof body.path === 'string' ? body.path.slice(0, 500) : null;
  const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : null;
  const sessionId = typeof body.session_id === 'string' ? body.session_id.slice(0, 100) : null;
  const metadata =
    body.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null;

  const ua = request.headers.get('user-agent');
  const parsed = parseUserAgent(ua);
  const geo = geoFromHeaders(request);

  // id visitatore stabile (cookie di prima parte). Generato server-side e
  // mantenuto anche dopo il login → correla anonimo ↔ account.
  let vid = readCookie(request.headers.get('cookie'), VID_COOKIE);
  let setCookie = false;
  if (!vid) {
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
