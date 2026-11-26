import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R18-015 — L'obbligo di allergeni e ingredienti è una proprietà della categoria principale
 * (colonna richiede_dichiarazioni_alimentari, migrazione 363), non il suo nome. La rotta admin delle
 * categorie la scrive, non confonde ogni 23514 con la foto, e i moduli/rotte che scelgono i campi
 * leggono la colonna insieme alle categorie.
 */

const A = '00000000-0000-4000-8000-00000000000a';
const C = '00000000-0000-4000-8000-00000000000c';
const scritto: { insert: Array<Record<string, unknown>>; update: Array<Record<string, unknown>> } = { insert: [], update: [] };
const stato = { erroreInsert: null as null | { code: string; message: string }, erroreUpdate: null as null | { code: string; message: string } };
const righe: Record<string, { id: string; parent_id: string | null }> = {
  [A]: { id: A, parent_id: null },
  [C]: { id: C, parent_id: A },
};

function tabella() {
  let op = 'select';
  let id: unknown = null;
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (_c: string, v: unknown) => { id = v; return b; },
    insert: (v: Record<string, unknown>) => { op = 'insert'; scritto.insert.push(v); return b; },
    update: (v: Record<string, unknown>) => { op = 'update'; scritto.update.push(v); return b; },
    single: async () => (stato.erroreInsert ? { data: null, error: stato.erroreInsert } : { data: { id: 'nuova' }, error: null }),
    maybeSingle: async () => ({ data: righe[id as string] ?? null, error: null }),
    then: (ok: (r: unknown) => unknown) =>
      Promise.resolve(op === 'update' ? { error: stato.erroreUpdate } : { data: null, error: null, count: 0 }).then(ok),
  };
  return b;
}
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: tabella }) }));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => {} }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) => h({ req, user: { id: 'admin-1' } }),
}));

async function chiama(metodo: 'POST' | 'PATCH', corpo: unknown) {
  const mod = await import('@/app/api/admin/categories/route');
  const h = (mod as unknown as Record<string, (r: Request) => Promise<Response>>)[metodo];
  const res = await h(new Request('http://x/api/admin/categories', {
    method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  }));
  return { status: res.status, json: (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { message?: string } } };
}

beforeEach(() => {
  scritto.insert.length = 0; scritto.update.length = 0;
  stato.erroreInsert = null; stato.erroreUpdate = null;
});

describe('R18-015 · la rotta admin delle categorie', () => {
  it('POST di una principale con la casella spuntata scrive richiede_dichiarazioni_alimentari, senza avviso', async () => {
    const r = await chiama('POST', { name: 'Gastronomia', slug: 'gastronomia', richiede_dichiarazioni_alimentari: true });
    expect(r.status).toBe(200);
    expect(scritto.insert[0].richiede_dichiarazioni_alimentari).toBe(true);
    expect(r.json.data?.avviso).toBeUndefined();
  });

  it('POST di una principale senza la casella risponde con l\'avviso che nasce senza campi obbligatori', async () => {
    const r = await chiama('POST', { name: 'Spesa fresca', slug: 'spesa-fresca' });
    expect(r.status).toBe(200);
    expect(scritto.insert[0]).not.toHaveProperty('richiede_dichiarazioni_alimentari');
    expect(String(r.json.data?.avviso)).toMatch(/allergeni e ingredienti/);
  });

  it('POST di una sottocategoria non porta l\'obbligo: si rifiuta se lo chiede, e non dà avviso se non lo chiede', async () => {
    const no = await chiama('POST', { name: 'Pane', slug: 'pane', parent_id: A, richiede_dichiarazioni_alimentari: true });
    expect(no.status).toBe(400);
    const si = await chiama('POST', { name: 'Pasta', slug: 'pasta', parent_id: A });
    expect(si.status).toBe(200);
    expect(si.json.data?.avviso).toBeUndefined();
  });

  it('PATCH accende l\'obbligo su una principale, ma non su una sottocategoria', async () => {
    const ok = await chiama('PATCH', { id: A, richiede_dichiarazioni_alimentari: true });
    expect(ok.status).toBe(200);
    expect(scritto.update[0].richiede_dichiarazioni_alimentari).toBe(true);
    scritto.update.length = 0;
    const no = await chiama('PATCH', { id: C, richiede_dichiarazioni_alimentari: true });
    expect(no.status).toBe(400);
    expect(scritto.update.length).toBe(0);
  });

  it('un 23514 del guardiano sull\'obbligo non diventa «Foto non ammessa»; uno della foto sì', async () => {
    stato.erroreUpdate = { code: '23514', message: 'Lo slug di «Alimentari» non si cambia: da questa categoria dipende l\'obbligo di allergeni e ingredienti.' };
    const slug = await chiama('PATCH', { id: A, slug: 'nuovo-nome' });
    expect(slug.json.error?.message).toMatch(/Lo slug di «Alimentari» non si cambia/);
    expect(slug.json.error?.message).not.toMatch(/Foto non ammessa/);
    stato.erroreUpdate = { code: '23514', message: 'new row violates check constraint "categories_image_url_check"' };
    const foto = await chiama('PATCH', { id: A, name: 'Alimentari' });
    expect(foto.json.error?.message).toMatch(/Foto non ammessa/);
    stato.erroreInsert = { code: '23514', message: 'L\'obbligo di allergeni e ingredienti di «Alimentari» non si toglie dal pannello.' };
    const crea = await chiama('POST', { name: 'X', slug: 'x' });
    expect(crea.json.error?.message).not.toMatch(/Foto non ammessa/);
  });
});

const sorgente = (p: string) => readFileSync(p, 'utf8');
const leggeLaColonna = (src: string) => /from\('categories'\)[\s\S]{0,80}\.select\('[^']*richiede_dichiarazioni_alimentari[^']*'\)/.test(src);

describe('R18-015 · chi sceglie i campi dalla categoria legge la colonna dell\'obbligo', () => {
  const file = [
    'app/seller/products/new/page.tsx',
    'app/seller/products/[id]/edit/page.tsx',
    'app/admin/products/new/page.tsx',
    'app/admin/products/[id]/edit/page.tsx',
    'app/api/ai/catalog-chat/route.ts',
    'app/api/ai/catalog-apply/route.ts',
    'app/api/ai/catalog-batch/start/route.ts',
    'app/api/ai/copilot/route.ts',
    'app/api/seller/products/import/route.ts',
  ];
  for (const f of file) {
    it(`${f}: il select delle categorie porta richiede_dichiarazioni_alimentari`, () => {
      expect(leggeLaColonna(sorgente(f))).toBe(true);
    });
  }

  it('catalog-chat passa la colonna a getAttributesForCategory (non la toglie con la mappa)', () => {
    const src = sorgente('app/api/ai/catalog-chat/route.ts');
    const dopo = src.slice(src.lastIndexOf('getAttributesForCategory('));
    expect(dopo.slice(0, 400)).toMatch(/richiede_dichiarazioni_alimentari/);
  });

  it('il pannello categorie ha la casella e la manda alla rotta', () => {
    const src = sorgente('app/admin/categories/page.tsx');
    expect(src).toMatch(/Richiede allergeni e ingredienti/);
    expect(src).toMatch(/richiede_dichiarazioni_alimentari: alimentare/);
    expect(src).toMatch(/richiede_dichiarazioni_alimentari: true/);
    expect(src).toMatch(/avviso/);
  });
});
