import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S05 · schede 334, 582, 34, 225 (categorie) — la rotta admin delle categorie:
 * ① un genitore dev'essere una principale e non la categoria stessa (niente
 *   nipoti invisibili, niente cerchi A→B→A che bloccano il modulo prodotto);
 * ② non si elimina una categoria con sottocategorie o prodotti (i vincoli del
 *   database cancellano a cascata e svuotano i prodotti, non proteggono);
 * ③ ogni scrittura lascia una riga nel registro delle azioni;
 * ④ chi non è admin riceve ancora il rifiuto.
 */

type Riga = { id: string; parent_id?: string | null; category_id?: string | null; name?: string; slug?: string };
const db: Record<string, Riga[]> = { categories: [], products: [] };
const scritture: string[] = [];
const audit = vi.fn(async (_e: unknown) => {});

function tabella(nome: string) {
  const filtri: Array<[string, unknown]> = [];
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select';
  let conta = false;
  let valori: Record<string, unknown> = {};
  const righe = () => db[nome].filter((r) => filtri.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
  const fine = () => {
    if (op === 'select') return conta ? { count: righe().length, error: null } : { data: righe(), error: null };
    scritture.push(`${op}:${nome}`);
    if (op === 'delete') { const via = righe(); db[nome] = db[nome].filter((r) => !via.includes(r)); }
    if (op === 'update') righe().forEach((r) => Object.assign(r, valori));
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string }) => { if (o?.count) conta = true; return b; },
    eq: (c: string, v: unknown) => { filtri.push([c, v]); return b; },
    update: (v: Record<string, unknown>) => { op = 'update'; valori = v; return b; },
    delete: () => { op = 'delete'; return b; },
    insert: (v: Record<string, unknown>) => { op = 'insert'; valori = v; db[nome].push({ id: 'nuova', ...v } as Riga); scritture.push(`insert:${nome}`); return b; },
    single: async () => ({ data: { id: 'nuova' }, error: null }),
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    then: (ok: (r: unknown) => unknown) => Promise.resolve(fine()).then(ok),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: tabella }) }));
vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
vi.mock('@/lib/api/middleware', () => ({
  // Come il vero withAdminAuth: chi non è admin si ferma a 403.
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    req.headers.get('x-ruolo') === 'admin' ? h({ req, user: { id: 'admin-1' } }) : new Response('Solo admin', { status: 403 }),
}));

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

async function chiama(metodo: 'POST' | 'PATCH' | 'DELETE', corpo: unknown, ruolo = 'admin') {
  const mod = await import('@/app/api/admin/categories/route');
  const h = (mod as unknown as Record<string, (r: Request) => Promise<Response>>)[metodo];
  return h(new Request('http://x/api/admin/categories', {
    method: metodo, headers: { 'content-type': 'application/json', 'x-ruolo': ruolo }, body: JSON.stringify(corpo),
  }));
}

beforeEach(() => {
  // A principale con figlia C; B principale senza figli.
  db.categories = [
    { id: A, parent_id: null, name: 'Alimentari', slug: 'alimentari' },
    { id: B, parent_id: null, name: 'Casa', slug: 'casa' },
    { id: C, parent_id: A, name: 'Pane', slug: 'pane' },
  ];
  db.products = [];
  scritture.length = 0;
  audit.mockClear();
});

describe('rotta admin categorie', () => {
  it('chi non è admin riceve ancora 403, per tutti e tre i metodi', async () => {
    for (const m of ['POST', 'PATCH', 'DELETE'] as const) {
      expect((await chiama(m, { id: B }, 'buyer')).status).toBe(403);
    }
    expect(scritture).toEqual([]);
  });

  it('334: una principale con sottocategorie non diventa figlia', async () => {
    const r = await chiama('PATCH', { id: A, parent_id: B });
    expect(r.status).toBe(400);
    expect(db.categories.find((c) => c.id === A)?.parent_id).toBeNull();
  });

  it('34: una categoria non diventa genitore di se stessa, né figlia di una sottocategoria', async () => {
    expect((await chiama('PATCH', { id: B, parent_id: B })).status).toBe(400);
    expect((await chiama('PATCH', { id: B, parent_id: C })).status).toBe(400);
    expect((await chiama('PATCH', { id: A, parent_id: C })).status).toBe(400); // il cerchio A→C→A
    expect(scritture).toEqual([]);
  });

  it('una principale senza figli sotto un’altra principale va bene, e si registra', async () => {
    expect((await chiama('PATCH', { id: B, parent_id: A })).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'category.update', targetId: B }));
  });

  it('582: non si elimina una categoria con sottocategorie o prodotti', async () => {
    const r = await chiama('DELETE', { id: A });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toMatch(/1 sottocategoria/);
    db.products = [{ id: 'p1', category_id: B }];
    const r2 = await chiama('DELETE', { id: B });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(await r2.json())).toMatch(/1 prodotto/);
    expect(db.categories).toHaveLength(3);
  });

  it('225: eliminare una categoria libera la cancella e lascia nome e slug nel registro', async () => {
    expect((await chiama('DELETE', { id: C })).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category.delete', targetId: C, metadata: { name: 'Pane', slug: 'pane' },
    }));
  });
});
