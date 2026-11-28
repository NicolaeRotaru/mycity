import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R04-004 (onda 2, 28/11/2026) — CANCELLARE (O SPOSTARE) UNA CATEGORIA CON L'OBBLIGO DEGLI
 * ALLERGENI DÀ IL MOTIVO DEL DATABASE, NON UN ERRORE GENERICO.
 *
 * La guardia della migrazione 363 rifiuta con 23514 e una frase per chi amministra. La rotta
 * rispondeva «Impossibile eliminare la categoria» (500) alla cancellazione e «Foto non ammessa dal
 * database» al cambio di slug. Qui la rotta è quella vera; il database finto alza la stessa
 * eccezione della guardia.
 */

type Riga = { id: string; parent_id?: string | null; name?: string; slug?: string };
const db: Record<string, Riga[]> = { categories: [], products: [] };
const guasti: Record<string, { code: string; message: string } | null> = { update: null, delete: null };

function tabella(nome: string) {
  const filtri: Array<[string, unknown]> = [];
  let op: 'select' | 'update' | 'delete' = 'select';
  let conta = false;
  const righe = () => db[nome].filter((r) => filtri.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
  const fine = () => {
    if (op === 'select') return conta ? { count: righe().length, error: null } : { data: righe(), error: null };
    return { data: null, error: guasti[op] };
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string }) => { if (o?.count) conta = true; return b; },
    eq: (c: string, v: unknown) => { filtri.push([c, v]); return b; },
    update: () => { op = 'update'; return b; },
    delete: () => { op = 'delete'; return b; },
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    then: (ok: (r: unknown) => unknown) => Promise.resolve(fine()).then(ok),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: tabella }) }));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) => h({ req, user: { id: 'admin-1' } }),
}));

const A = '00000000-0000-4000-8000-00000000000a';

async function chiama(metodo: 'PATCH' | 'DELETE', corpo: unknown) {
  const mod = await import('@/app/api/admin/categories/route');
  const h = (mod as unknown as Record<string, (r: Request) => Promise<Response>>)[metodo];
  const res = await h(new Request('http://x/api/admin/categories', {
    method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  }));
  const j = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: j.error?.message ?? '' };
}

beforeEach(() => {
  db.categories = [{ id: A, parent_id: null, name: 'Alimentari', slug: 'alimentari' }];
  db.products = [];
  guasti.update = null;
  guasti.delete = null;
});

describe('R04-004 · la guardia degli allergeni parla con la sua frase', () => {
  it('IL CASO CHE ROMPEVA — cancellare «Alimentari»: 400 col motivo del database, non 500 generico', async () => {
    guasti.delete = { code: '23514', message: 'La categoria «Alimentari» non si cancella: da lei dipende l\'obbligo di allergeni e ingredienti.' };
    const r = await chiama('DELETE', { id: A });
    expect(r.status, 'il rifiuto della guardia è passato per un guasto del server').toBe(400);
    expect(r.messaggio).toBe('La categoria «Alimentari» non si cancella: da lei dipende l\'obbligo di allergeni e ingredienti.');
  });

  it('IL CASO CHE ROMPEVA — cambiare lo slug di «Alimentari»: il motivo vero, non «Foto non ammessa»', async () => {
    guasti.update = { code: '23514', message: 'Lo slug di «Alimentari» non si cambia: da questa categoria dipende l\'obbligo di allergeni e ingredienti.' };
    const r = await chiama('PATCH', { id: A, slug: 'cibo' });
    expect(r.status).toBe(400);
    expect(r.messaggio).not.toMatch(/Foto/);
    expect(r.messaggio).toMatch(/Lo slug di «Alimentari» non si cambia/);
  });

  it('controprova: il 23514 della foto resta la frase della foto', async () => {
    guasti.update = { code: '23514', message: 'new row for relation "categories" violates check constraint "categories_image_url_format"' };
    const r = await chiama('PATCH', { id: A, image_url: '/foto.jpg' });
    expect(r.status).toBe(400);
    expect(r.messaggio).toMatch(/Foto non ammessa/);
  });

  it('controprova: un altro guasto della cancellazione resta un guasto (500), senza testo del motore', async () => {
    guasti.delete = { code: '57014', message: 'canceling statement due to statement timeout' };
    const r = await chiama('DELETE', { id: A });
    expect(r.status).toBe(500);
    expect(r.messaggio).toBe('Impossibile eliminare la categoria');
  });
});
