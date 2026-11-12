import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R09-006 — Il caricamento da file scriveva i prodotti direttamente dal browser: non esisteva una
 * rotta in cui mettere il freno CARICAMENTO_DA_FILE_ACCESO, e «in vendita / bozza» lo decideva il
 * browser. Adesso passa da POST /api/seller/products/import.
 */
const stato = vi.hoisted(() => ({ acceso: false, scritte: [] as Array<Record<string, unknown>>, tracce: [] as unknown[] }));

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  get CARICAMENTO_DA_FILE_ACCESO() { return stato.acceso; },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: async (e: unknown) => { stato.tracce.push(e); } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const CATEGORIE = [{ id: 'cat-alim', slug: 'alimentari', parent_id: null }, { id: 'cat-abb', slug: 'abbigliamento', parent_id: null }];
const supaUtente = {
  from: (t: string) => (t === 'categories'
    ? { select: async () => ({ data: CATEGORIE, error: null }) }
    : { insert: async (righe: Array<Record<string, unknown>>) => { stato.scritte.push(...righe); return { error: null }; } }),
};
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuthRateLimit: (_o: unknown, h: (a: unknown) => unknown) => (req: unknown) =>
    h({ req, user: { id: 'negozio-1' }, supaUtente, params: {} }),
}));

async function manda(righe: unknown[]) {
  const { POST } = await import('@/app/api/seller/products/import/route');
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/seller/products/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ righe }),
  }));
  return { status: res.status, corpo: await res.json() };
}

const RIGA = {
  name: 'T-shirt cotone', description: '100% cotone biologico, taglie S-XL, lavabile a 30 gradi', price: 19.9, stock: 15,
  category_id: 'cat-abb', attributes: {}, status: 'available', seller_id: 'un-altro-negozio',
};

beforeEach(() => { stato.acceso = false; stato.scritte = []; stato.tracce = []; });

describe('R09-006 · il caricamento da file passa da una rotta col freno', () => {
  it('con l’interruttore spento la rotta dice no e non scrive niente', async () => {
    const { status } = await manda([RIGA]);
    expect(status).toBe(503);
    expect(stato.scritte).toHaveLength(0);
  });

  it('acceso: lo stato e il negozio li decide il server, non il browser, e resta la traccia', async () => {
    stato.acceso = true;
    const { status, corpo } = await manda([RIGA]);
    expect(status).toBe(200);
    expect(stato.scritte).toHaveLength(1);
    // Il file non porta foto: nasce bozza anche se il browser dice «available».
    expect(stato.scritte[0].status).toBe('draft');
    expect(stato.scritte[0].seller_id).toBe('negozio-1');
    expect(corpo.data).toMatchObject({ importati: 1, bozze: 1 });
    expect(stato.tracce).toHaveLength(1);
  });

  it('una riga sbagliata non arriva al database', async () => {
    stato.acceso = true;
    const { status } = await manda([{ ...RIGA, price: -3 }]);
    expect(status).toBe(400);
    expect(stato.scritte).toHaveLength(0);
  });

  it('la pagina non scrive più i prodotti dal browser', () => {
    const pagina = readFileSync('app/seller/products/import/page.tsx', 'utf8');
    expect(pagina).not.toMatch(/from\('products'\)\.insert\(/);
    expect(pagina).toContain("'/api/seller/products/import'");
  });
});
