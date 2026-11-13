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
 * risposta minimale { lat, lng, luogo }. Se Nominatim è giù/lento, rispondiamo 200 con
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

  // 13/11/2026 (R13-001) — La stessa ricerca del server dell'ordine (lib/geocodifica.ts):
  // prima qui c'era una copia a testo libero, con un solo risultato e nessun confine, e
  // «Via Roma 10, 29121 Piacenza» tornava a Podenzano. Chi la chiama (la cassa che avvisa
  // della zona, la rubrica degli indirizzi, il negozio che fissa la posizione) riceve ora la
  // risposta che userà il server. «Non so» resta 200 con { lat: null, lng: null }.
  const trovato = await coordinateDiUnIndirizzo(q);
  // `luogo` (R13-006): il nome del posto trovato, che il selettore del negozio mostra sotto il campo.
  return NextResponse.json({ lat: trovato?.lat ?? null, lng: trovato?.lng ?? null, luogo: trovato?.luogo ?? null });
}
