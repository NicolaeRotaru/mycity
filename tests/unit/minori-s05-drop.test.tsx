// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';

/**
 * S05 · schede 1837, 1838, 1839, 1840, 1816 — il Drop del giorno.
 * La rotta: prezzi ricavati dal prodotto vero, solo prodotti in vetrina, niente
 * sovrascrittura in silenzio, DELETE che dice se non c'era niente, registro
 * delle azioni. La pagina spenta: avviso in cima e modulo disattivato.
 * Chi non è admin riceve ancora il rifiuto.
 */

const stato = vi.hoisted(() => ({
  acceso: true,
  prodotto: null as unknown,
  esistente: null as unknown,
  tolti: [] as unknown[],
  upsert: [] as unknown[],
}));
const audit = vi.fn(async (_e: unknown) => {});

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  get DROP_DEL_GIORNO_ACCESO() { return stato.acceso; },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      let cancella = false;
      Object.assign(b, {
        select: () => (cancella ? Promise.resolve({ data: stato.tolti, error: null }) : b),
        eq: () => b,
        delete: () => { cancella = true; return b; },
        maybeSingle: async () => ({ data: t === 'products' ? stato.prodotto : stato.esistente, error: null }),
        upsert: async (v: unknown) => { stato.upsert.push(v); return { error: null }; },
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    req.headers.get('x-ruolo') === 'admin' ? h({ req, user: { id: 'admin-1' } }) : new Response('Solo admin', { status: 403 }),
}));

const PROD = '00000000-0000-4000-8000-0000000000p1'.replace('p1', 'a1');
type H = (r: Request) => Promise<Response>;
async function rotta(metodo: 'POST' | 'DELETE', corpo: unknown, ruolo = 'admin') {
  const mod = (await import('@/app/api/admin/daily-drops/route')) as unknown as Record<string, H>;
  return mod[metodo](new Request('http://x', { method: metodo, headers: { 'content-type': 'application/json', 'x-ruolo': ruolo }, body: JSON.stringify(corpo) }));
}
const CORPO = { product_id: PROD, drop_date: '2026-11-20', discount_percent: 50, original_price: 100, drop_price: 150 };

beforeEach(() => {
  stato.acceso = true;
  stato.prodotto = { id: PROD, price: 20, status: 'available', seller: { is_approved: true, role: 'seller' } };
  stato.esistente = null;
  stato.tolti = [];
  stato.upsert.length = 0;
  audit.mockClear();
});

describe('rotta del Drop del giorno', () => {
  it('chi non è admin riceve ancora 403 su POST e DELETE', async () => {
    expect((await rotta('POST', CORPO, 'buyer')).status).toBe(403);
    expect((await rotta('DELETE', { drop_date: '2026-11-20' }, 'seller')).status).toBe(403);
    expect(stato.upsert).toHaveLength(0);
  });

  it('1837: i prezzi vengono dal prodotto, non dal browser', async () => {
    expect((await rotta('POST', CORPO)).status).toBe(200);
    expect(stato.upsert[0]).toMatchObject({ original_price: 20, drop_price: 10 });
  });

  it('1838: prodotto non in vendita o negozio non approvato → 400', async () => {
    stato.prodotto = { id: PROD, price: 20, status: 'draft', seller: { is_approved: true, role: 'seller' } };
    expect((await rotta('POST', CORPO)).status).toBe(400);
    stato.prodotto = { id: PROD, price: 20, status: 'available', seller: { is_approved: false, role: 'seller' } };
    expect((await rotta('POST', CORPO)).status).toBe(400);
    expect(stato.upsert).toHaveLength(0);
  });

  it('1840: un drop già salvato per quel giorno non si sovrascrive senza dirlo', async () => {
    stato.esistente = { id: 'd1' };
    expect((await rotta('POST', CORPO)).status).toBe(409);
    expect(stato.upsert).toHaveLength(0);
    expect((await rotta('POST', { ...CORPO, sovrascrivi: true })).status).toBe(200);
  });

  it('1840: DELETE senza drop per quella data → 404, non ok:true', async () => {
    expect((await rotta('DELETE', { drop_date: '2026-11-20' })).status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it('1839: POST e DELETE lasciano la riga nel registro', async () => {
    await rotta('POST', CORPO);
    stato.tolti = [{ id: 'd1', product_id: PROD }];
    await rotta('DELETE', { drop_date: '2026-11-20' });
    expect(audit.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual(['daily_drop.create', 'daily_drop.delete']);
  });
});

describe('pagina del Drop spento', () => {
  let chiudi: (() => void) | null = null;
  afterEach(() => { chiudi?.(); chiudi = null; });
  it('1816: in cima dice che è spento, non «mostrate in home», e il modulo è disattivato', async () => {
    stato.acceso = false;
    vi.doMock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
    vi.doMock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
    vi.doMock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
    const { disegna } = await import('./aiuti/cabina-admin');
    const mod = (await import('@/app/admin/daily-drops/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    expect(r.host.textContent).not.toContain('mostrate in home');
    expect(r.host.querySelector('fieldset')?.disabled).toBe(true);
    const nota = r.host.querySelector('#drop-spento');
    expect(nota).not.toBeNull();
    const salva = [...r.host.querySelectorAll('button')].find((b) => b.textContent?.includes('Salva drop'));
    expect(salva?.getAttribute('aria-describedby')).toBe('drop-spento');
  });
});
