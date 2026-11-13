import { describe, it, expect, vi } from 'vitest';

/**
 * R10-006 — Ogni scheda dell'elenco dei negozi chiede /api/consegna/veloce per
 * il suo negozio. Il freno era 30 domande al minuto per indirizzo, lo stesso che
 * usano carrello e cassa: con più di 30 negozi in lista, il carrello riceveva
 * 429 e la cassa diceva «non riesco a confermare la consegna veloce».
 *
 * Qui il freno è quello VERO (in memoria, senza Upstash); la banca dati è finta.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = () => q;
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(ok);
      return q;
    },
  }),
}));

const { GET } = await import('@/app/api/consegna/veloce/route');

const negozio = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const chiedi = (ip: string, ids: string[]) =>
  GET(new Request(`http://localhost/api/consegna/veloce?negozi=${ids.join(',')}`, { headers: { 'x-forwarded-for': ip } }));

describe('R10-006 — la lista dei negozi non consuma il freno del carrello', () => {
  it('40 schede dell’elenco, poi il carrello: il carrello ha la sua risposta', async () => {
    const ip = '203.0.113.61';
    for (let i = 1; i <= 40; i++) await chiedi(ip, [negozio(i)]);
    const carrello = await chiedi(ip, [negozio(901), negozio(902)]);
    expect(carrello.status, 'il carrello riceve 429 per colpa della lista').not.toBe(429);
  });

  it('la stessa domanda ripetuta resta frenata a 30 al minuto', async () => {
    const ip = '203.0.113.62';
    const stati: number[] = [];
    for (let i = 0; i < 31; i++) stati.push((await chiedi(ip, [negozio(7)])).status);
    expect(stati.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(stati[30]).toBe(429);
  });

  it('chi gira gli id per aggirare il freno trova un tetto per indirizzo', async () => {
    const ip = '203.0.113.63';
    let frenate = 0;
    for (let i = 1; i <= 130; i++) if ((await chiedi(ip, [negozio(i)])).status === 429) frenate += 1;
    expect(frenate).toBeGreaterThan(0);
  });
});
