/**
 * La rotta degli indirizzi distingue «nessun risultato» (200, coordinate nulle) da
 * «servizio giù o limitato» (503 con error: servizio_non_disponibile).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true }),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://esempio.test' } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => undefined, error: () => undefined, info: () => undefined } }));

import { POST } from '@/app/api/geocode/route';

const chiedi = () =>
  POST(
    new Request('http://localhost/api/geocode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'Via Roma 10, Piacenza, Italia' }),
    }),
  );

afterEach(() => vi.unstubAllGlobals());

describe('/api/geocode: servizio giù contro nessun risultato', () => {
  it('nessun risultato: 200 con coordinate nulle e senza errore', async () => {
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));
    const res = await chiedi();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lat: null, lng: null });
  });

  it('trovato: coordinate', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([{ lat: '45.05', lon: '9.69' }]), { status: 200 }));
    const res = await chiedi();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lat: 45.05, lng: 9.69 });
  });

  for (const stato of [500, 502, 503]) {
    it(`Nominatim risponde ${stato}: 503 servizio_non_disponibile`, async () => {
      vi.stubGlobal('fetch', async () => new Response('', { status: stato }));
      const res = await chiedi();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ lat: null, lng: null, error: 'servizio_non_disponibile' });
    });
  }

  // 27/11/2026 — «Troppe richieste» delle mappe resta un 429 (la rubrica indirizzi non lo salva come
  // «posizione non trovata»), con lo stesso corpo del servizio giù.
  it('Nominatim risponde 429: 429 servizio_non_disponibile', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));
    const res = await chiedi();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ lat: null, lng: null, error: 'servizio_non_disponibile' });
  });

  it('errore di rete o tempo scaduto: 503 servizio_non_disponibile', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const res = await chiedi();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('servizio_non_disponibile');
  });
});
