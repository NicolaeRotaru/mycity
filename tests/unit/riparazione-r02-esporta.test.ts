import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R02-004 (12/11/2026) — Lo scarico dei miei dati non si ferma a mille righe e non si dice completo
 * quando non lo è. Il Supabase finto rispetta il tetto vero dell'interfaccia del database
 * (`max_rows` di supabase/config.toml): ogni lettura, con limit o con range, ne dà al massimo tante.
 */

const MAX_ROWS = Number(/max_rows\s*=\s*(\d+)/.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1]);
const righePer: Record<string, number> = {};

function righe(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, handler: (ctx: { user: { id: string; email: string } }) => unknown) =>
    () => handler({ user: { id: 'u-1', email: 'anna@example.com' } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      let da = 0;
      let quante = Infinity;
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'or', 'order']) q[m] = () => q;
      q.limit = (n: number) => { quante = n; return q; };
      q.range = (a: number, b: number) => { da = a; quante = b - a + 1; return q; };
      q.single = async () => ({ data: { id: 'u-1' }, error: null });
      q.then = (ok: (v: unknown) => unknown) => {
        const tutte = righe(righePer[tabella] ?? 0);
        const fetta = tutte.slice(da, da + Math.min(quante, MAX_ROWS));
        return Promise.resolve({ data: fetta, error: null }).then(ok);
      };
      return q;
    },
  }),
}));

import { GET } from '@/app/api/account/export/route';

const chiama = () => (GET as unknown as () => Promise<Response>)();

describe('R02-004 · lo scarico dei dati oltre le mille righe', () => {
  beforeEach(() => {
    for (const k of Object.keys(righePer)) delete righePer[k];
  });

  it('il tetto del database è davvero più basso del tetto per sezione (altrimenti la prova non dice niente)', () => {
    expect(MAX_ROWS).toBeGreaterThan(0);
    expect(MAX_ROWS).toBeLessThan(1100);
  });

  it('1100 notifiche escono tutte, e il file si dice completo solo perché lo è', async () => {
    righePer.notifications = 1100;
    const res = await chiama();
    const corpo = await res.json();
    expect(corpo.notifications).toHaveLength(1100);
    expect(corpo.export_metadata.export_completo).toBe(true);
    expect(corpo.sezioni_al_tetto).toEqual([]);
  });

  it('oltre il tetto per sezione il file si dichiara INCOMPLETO', async () => {
    righePer.product_views = 7000;
    const res = await chiama();
    const corpo = await res.json();
    expect(corpo.prodotti_visti).toHaveLength(5000);
    expect(corpo.sezioni_al_tetto).toContain('prodotti_visti');
    expect(corpo.export_metadata.export_completo).toBe(false);
    expect(res.headers.get('content-disposition')).toContain('INCOMPLETO');
  });

  it('esattamente al tetto, senza una riga in più, non si dice incompleto', async () => {
    righePer.product_views = 5000;
    const corpo = await (await chiama()).json();
    expect(corpo.prodotti_visti).toHaveLength(5000);
    expect(corpo.sezioni_al_tetto).toEqual([]);
  });
});
