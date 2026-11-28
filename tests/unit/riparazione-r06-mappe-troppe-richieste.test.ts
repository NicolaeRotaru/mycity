/**
 * Quando è il servizio delle mappe a dire «troppe richieste», la rotta degli indirizzi non risponde
 * come per «nessun risultato» né come per «servizio giù»: risponde 429. La rubrica indirizzi
 * (app/profile/addresses/page.tsx) sul 429 tiene aperto il modulo e dice di riprovare; su qualunque
 * altra risposta senza coordinate salvava l'indirizzo come «posizione non trovata».
 *
 * Finto è solo il servizio delle mappe; la rotta e la ricerca (lib/geocodifica.ts) sono quelle vere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true }),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://esempio.test' } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => undefined, error: () => undefined, info: () => undefined } }));

import { POST } from '@/app/api/geocode/route';

const chiedi = (q: string) =>
  POST(
    new Request('http://localhost/api/geocode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q }),
    }),
  );

const mappeRispondono = (status: number, corpo: unknown = []) =>
  vi.stubGlobal('fetch', async (input: unknown) => {
    expect(String(input)).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
    return new Response(status === 200 ? JSON.stringify(corpo) : '', { status });
  });

afterEach(() => vi.unstubAllGlobals());

describe('/api/geocode: «troppe richieste» delle mappe resta un 429', () => {
  it('le mappe rispondono 429: la rotta risponde 429, senza coordinate e con l\'errore del servizio', async () => {
    mappeRispondono(429);
    const res = await chiedi('Via Roma 10, 29121 Piacenza, Italia');
    expect(res.status, 'il «troppe richieste» delle mappe arrivava alla rubrica come un\'altra risposta').toBe(429);
    expect(await res.json()).toEqual({ lat: null, lng: null, error: 'servizio_non_disponibile' });
  });

  it('le mappe rispondono 429 anche a una ricerca senza città: 429', async () => {
    mappeRispondono(429);
    const res = await chiedi('Via Roma 10, Italia');
    expect(res.status).toBe(429);
  });

  it('le mappe sono giù (502): resta 503', async () => {
    mappeRispondono(502);
    const res = await chiedi('Via Roma 10, 29121 Piacenza, Italia');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ lat: null, lng: null, error: 'servizio_non_disponibile' });
  });

  it('nessun risultato (200 vuoto): resta 200 con coordinate nulle', async () => {
    mappeRispondono(200, []);
    const res = await chiedi('Via Roma 10, 29121 Piacenza, Italia');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lat: null, lng: null });
  });

  it('trovato a Piacenza (200 con coordinate): 200 con coordinate e nome', async () => {
    mappeRispondono(200, [
      { lat: '45.0497', lon: '9.6985', display_name: 'Via Roma, Piacenza', address: { city: 'Piacenza', postcode: '29121' } },
    ]);
    const res = await chiedi('Via Roma 10, 29121 Piacenza, Italia');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lat: 45.0497, lng: 9.6985, nome: 'Via Roma, Piacenza' });
  });

  it('solo un risultato fuori da Piacenza per una ricerca senza città: 200 senza coordinate', async () => {
    mappeRispondono(200, [{ lat: '41.9009', lon: '12.4833', display_name: 'Via Roma, Roma', address: { city: 'Roma' } }]);
    const res = await chiedi('Via Roma 10, Italia');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lat: null, lng: null });
  });
});
