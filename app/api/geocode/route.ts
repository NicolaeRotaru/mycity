import { NextResponse } from 'next/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { coordinateDiUnIndirizzo } from '@/lib/geocodifica';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

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
    const body = (await jsonRichiesta(req, TETTO_JSON)) as { q?: unknown };
    q = typeof body.q === 'string' ? body.q.trim().slice(0, 300) : '';
  } catch {
    return NextResponse.json({ lat: null, lng: null }, { status: 400 });
  }
  if (q.length < 3) return NextResponse.json({ lat: null, lng: null });

  // R03-010 — Un turno al secondo per tutto il sito, lo stesso della rotta d'ordine (lib/geocodifica.ts).
  try {
    const pos = await coordinateDiUnIndirizzo({ testo: q }, { seOccupato: 'lancia' });
    return NextResponse.json({ lat: pos?.lat ?? null, lng: pos?.lng ?? null });
  } catch (e) {
    if (e instanceof Error && e.message === 'nominatim_occupato') {
      return NextResponse.json({ lat: null, lng: null, error: 'rate_limited' }, { status: 429 });
    }
    return NextResponse.json({ lat: null, lng: null });
  }
}
