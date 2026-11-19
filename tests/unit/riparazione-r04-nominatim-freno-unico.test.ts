import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R04-009 — un freno unico per tutto il sito sulle chiamate a Nominatim (~1 al secondo),
 * nella rotta /api/geocode e in coordinateDiUnIndirizzo. Il contatore è finto ma fa da
 * contatore CONDIVISO: una finestra fissa per chiave, con l'orologio finto.
 */

const finestre = new Map<string, { inizio: number; n: number }>();
const stato = { chiavi: [] as string[], muto: false };

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '10.0.0.1',
  rateLimitAsync: async ({ key, max, windowMs }: { key: string; max: number; windowMs: number }) => {
    stato.chiavi.push(key);
    if (stato.muto && key === 'nominatim:globale') return new Promise(() => {});
    const ora = Date.now();
    let f = finestre.get(key);
    if (!f || ora - f.inizio >= windowMs) { f = { inizio: ora, n: 0 }; finestre.set(key, f); }
    f.n += 1;
    const allowed = f.n <= max;
    return { allowed, remaining: Math.max(0, max - f.n), retryAfterSec: allowed ? 0 : 1, limit: max };
  },
}));

const chiamate = { n: 0 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
  finestre.clear();
  stato.chiavi = [];
  stato.muto = false;
  chiamate.n = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    chiamate.n += 1;
    return new Response(JSON.stringify([{ lat: '41.9', lon: '12.5' }]), { status: 200 });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const chiediRotta = async (ip = '10.0.0.1') => {
  const { POST } = await import('@/app/api/geocode/route');
  return POST(new Request('http://x/api/geocode', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ q: 'Via Roma 1, Roma' }),
  }));
};
const indirizzo = { address: 'Via Roma 1', city: 'Roma', zip: '00100' };

describe('R04-009 — /api/geocode', () => {
  it('due richieste nello stesso secondo: la prima chiama Nominatim, la seconda prende 429 e non chiama', async () => {
    const a = await chiediRotta();
    const b = await chiediRotta('10.0.0.2');
    expect(a.status).toBe(200);
    expect(b.status).toBe(429);
    expect(chiamate.n, 'una sola chiamata a Nominatim nel secondo').toBe(1);
    expect(stato.chiavi).toContain('nominatim:globale');
  });

  it('passato il secondo si può richiamare', async () => {
    await chiediRotta();
    vi.setSystemTime(new Date('2026-11-19T10:00:01.100Z'));
    expect((await chiediRotta()).status).toBe(200);
    expect(chiamate.n).toBe(2);
  });
});

describe('R04-009 — coordinateDiUnIndirizzo (percorso d\'ordine)', () => {
  it('col freno libero trova le coordinate', async () => {
    const { coordinateDiUnIndirizzo } = await import('@/lib/geocodifica');
    expect(await coordinateDiUnIndirizzo(indirizzo)).toEqual({ lat: 41.9, lng: 12.5 });
  });

  it('freno pieno: niente coordinate, nessuna chiamata, e l\'attesa non supera 300 ms', async () => {
    const { coordinateDiUnIndirizzo } = await import('@/lib/geocodifica');
    await chiediRotta(); // consuma il turno del secondo
    const prima = Date.now();
    const p = coordinateDiUnIndirizzo(indirizzo);
    await vi.advanceTimersByTimeAsync(300);
    expect(await p).toBeNull();
    expect(Date.now() - prima).toBeLessThanOrEqual(300);
    expect(chiamate.n, 'solo la chiamata della rotta').toBe(1);
  });

  it('contatore che non risponde: dopo 300 ms si rinuncia alle coordinate, senza chiamare Nominatim', async () => {
    const { coordinateDiUnIndirizzo } = await import('@/lib/geocodifica');
    stato.muto = true;
    const prima = Date.now();
    const p = coordinateDiUnIndirizzo(indirizzo);
    await vi.advanceTimersByTimeAsync(300);
    expect(await p).toBeNull();
    expect(Date.now() - prima).toBeLessThanOrEqual(300);
    expect(chiamate.n).toBe(0);
  });
});
