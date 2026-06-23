import { NextResponse } from 'next/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Proxy server-side per il geocoding Nominatim (audit 🟠-15).
 *
 * Prima il geocoding veniva chiamato DAL BROWSER su nominatim.openstreetmap.org:
 *  - viola la Usage Policy Nominatim (richiede un User-Agent identificativo e
 *    vieta l'uso pesante; dal browser l'UA non è impostabile e gli IP sono
 *    eterogenei → rischio ban);
 *  - nessun rate-limit né timeout né fallback.
 * Qui centralizziamo: User-Agent corretto, timeout, rate-limit per IP, e una
 * risposta minimale { lat, lng }. Se Nominatim è giù/lento, rispondiamo 200 con
 * { lat: null, lng: null } (fallback morbido: il checkout prosegue senza coord).
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `geocode:${ip}`, max: 30, windowMs: 60_000 });
  if (!rl.allowed) return NextResponse.json({ lat: null, lng: null, error: 'rate_limited' }, { status: 429 });

  let q = '';
  try {
    const body = (await req.json()) as { q?: unknown };
    q = typeof body.q === 'string' ? body.q.trim().slice(0, 300) : '';
  } catch {
    return NextResponse.json({ lat: null, lng: null }, { status: 400 });
  }
  if (q.length < 3) return NextResponse.json({ lat: null, lng: null });

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=it`;
    const appUrl = env.appUrl();
    const res = await fetch(url, {
      headers: {
        // Nominatim Usage Policy: User-Agent identificativo obbligatorio.
        'User-Agent': `MyCity/1.0 (${appUrl})`,
        'Accept-Language': 'it',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return NextResponse.json({ lat: null, lng: null });
    const json = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = Array.isArray(json) ? json[0] : undefined;
    const lat = hit?.lat != null ? parseFloat(hit.lat) : null;
    const lng = hit?.lon != null ? parseFloat(hit.lon) : null;
    return NextResponse.json({
      lat: Number.isFinite(lat as number) ? lat : null,
      lng: Number.isFinite(lng as number) ? lng : null,
    });
  } catch {
    logger.warn('[geocode] Nominatim non raggiungibile', { qlen: q.length });
    return NextResponse.json({ lat: null, lng: null });
  }
}
