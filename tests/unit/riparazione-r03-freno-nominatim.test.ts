import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R03-010 — Un freno solo (circa una richiesta al secondo) verso Nominatim, per la rotta della
 * ricerca indirizzi e per quella d'ordine insieme. Orologio finto, fetch finto: niente rete.
 */

vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://prova.example' } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { coordinateDiUnIndirizzo } from '@/lib/geocodifica';
import { POST } from '@/app/api/geocode/route';

const chiamate: number[] = [];
let ip = 0;

const cercaDallaRotta = () =>
  POST(
    new Request('http://localhost/api/geocode', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ip}` },
      body: JSON.stringify({ q: 'Via Roma 1, 29121 Piacenza, Italia' }),
    }),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
  __resetRateLimitBuckets();
  chiamate.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    chiamate.push(Date.now());
    return new Response(JSON.stringify([{ lat: '45.05', lon: '9.69' }]), { status: 200 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R03-010 — un turno al secondo verso Nominatim per tutto il sito', () => {
  it('rotta di ricerca e rotta d’ordine insieme: tra una chiamata e l’altra passa almeno un secondo', async () => {
    const indirizzo = { address: 'Via Roma 1', city: 'Piacenza', zip: '29121' };
    const tutte = Promise.all([
      cercaDallaRotta(),
      coordinateDiUnIndirizzo(indirizzo),
      cercaDallaRotta(),
      coordinateDiUnIndirizzo(indirizzo),
    ]);
    await vi.advanceTimersByTimeAsync(6_000);
    const [r1, c1, r2, c2] = await tutte;
    expect((await r1.json()).lat).toBe(45.05);
    expect(c1).toEqual({ lat: 45.05, lng: 9.69 });
    expect((await r2.json()).lat).toBe(45.05);
    expect(c2).toEqual({ lat: 45.05, lng: 9.69 });
    expect(chiamate).toHaveLength(4);
    for (let i = 1; i < chiamate.length; i++) {
      expect(chiamate[i] - chiamate[i - 1], `chiamate ${i - 1} e ${i} troppo vicine`).toBeGreaterThanOrEqual(1_000);
    }
  });

  it('troppa coda: chi non trova il turno entro l’attesa massima non chiama Nominatim e la rotta risponde 429', async () => {
    const molte = Array.from({ length: 14 }, () => cercaDallaRotta());
    await vi.advanceTimersByTimeAsync(20_000);
    const risposte = await Promise.all(molte);
    const stati = risposte.map((r) => r.status);
    expect(stati.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(stati.filter((s) => s === 200).length).toBe(chiamate.length);
    expect(chiamate.length).toBeLessThanOrEqual(9);
  });
});
