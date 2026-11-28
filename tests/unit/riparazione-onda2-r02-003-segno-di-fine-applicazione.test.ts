import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R02-003 (onda 2) — IL SEGNO DI FINE DELL'APPLICAZIONE DEL CATALOGO.
 *
 * L'avvio di un lavoro nuovo aspetta finche' l'ultimo lavoro «applicato» non ha il segno di fine
 * (`catalog_ai_jobs.applicazione_finita_il`) ed e' di meno di 120 s (R13-001): cosi' un lavoro nuovo
 * non nasce a meta' di un'applicazione che potrebbe dover tornare «pronta». Ma il segno non lo
 * scriveva nessuno: dopo ogni applicazione finita l'avvio aspettava due minuti per niente. (Che
 * l'avvio non aspetti un lavoro col segno lo prova riparazione-r13-avvio-durante-applicazione.)
 *
 * Qui gira la rotta /apply vera su un database finto: il segno c'e' quando il lavoro resta
 * «applicato», non c'e' quando torna «pronto», e senza la colonna (migrazione non applicata)
 * l'applicazione va avanti lo stesso.
 */

const db = vi.hoisted(() => ({
  lavoro: null as Record<string, unknown> | null,
  prodotti: [] as Record<string, unknown>[],
  categorieRotte: false,
  rifiutaPronto: null as { code: string; message: string } | null,
  colonnaAssente: false,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    h({ user: { id: 'negozio-1' }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
const filtro = vi.hoisted(() => ({ cadeSu: new Set<string>() }));
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: async (p: { name: string }) => {
    if (filtro.cadeSu.has(p.name)) throw new Error('429');
    return { allowed: true };
  },
}));

vi.mock('@/lib/supabase/server', () => {
  type D = { op: 'select' | 'update'; valori: Record<string, unknown> | null; filtri: Record<string, unknown> };
  const risolvi = (tabella: string, d: D, una: boolean) => {
    if (tabella === 'categories') {
      return db.categorieRotte
        ? { data: null, error: { message: 'timeout' } }
        : { data: [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }], error: null };
    }
    if (tabella === 'catalog_ai_jobs') {
      if (d.op === 'update') {
        // Come PostgREST: una colonna che la tabella non ha fa cadere la scrittura intera.
        if (db.colonnaAssente && d.valori && 'applicazione_finita_il' in d.valori) {
          return { data: null, error: { code: 'PGRST204', message: "Could not find the 'applicazione_finita_il' column of 'catalog_ai_jobs' in the schema cache" } };
        }
        if (d.filtri.status !== undefined && db.lavoro?.status !== d.filtri.status) return { data: [], error: null };
        if (d.valori?.status === 'ready' && db.rifiutaPronto) return { data: null, error: db.rifiutaPronto };
        db.lavoro = { ...db.lavoro, ...d.valori };
        return { data: [{ id: db.lavoro.id }], error: null };
      }
      return { data: db.lavoro ? { ...db.lavoro } : null, error: null };
    }
    if (d.op === 'update') return { data: null, error: null };
    return { data: una ? null : db.prodotti, error: null };
  };
  const tabella = (nome: string) => {
    const d: D = { op: 'select', valori: null, filtri: {} };
    const q = {
      select: () => q,
      order: () => q,
      in: () => q,
      eq: (c: string, v: unknown) => { d.filtri[c] = v; return q; },
      update: (v: Record<string, unknown>) => { d.op = 'update'; d.valori = v; return q; },
      single: async () => risolvi(nome, d, true),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risolvi(nome, d, false)).then(ok, ko),
    };
    return q;
  };
  return { getAdminSupabase: () => ({ from: tabella }) };
});

import { POST } from '@/app/api/ai/catalog-batch/apply/route';

const prodotto = (id: string) => ({
  id, seller_id: 'negozio-1', name: `Prodotto ${id}`, description: 'Una descrizione abbastanza lunga.',
  price: 5, compare_at_price: null, unit: 'pezzo', condition: 'nuovo', stock: 3, status: 'available',
  images: ['https://mycity.test/f.jpg'], tags: [], has_variants: false, category_id: 'casa', attributes: {},
});

const applica = async () => {
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-batch/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: 'l1', productIds: ['p1', 'p2'] }),
    }) as never,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.categorieRotte = false;
  db.rifiutaPronto = null;
  db.colonnaAssente = false;
  filtro.cadeSu.clear();
  db.prodotti = [prodotto('p1'), prodotto('p2')];
  db.lavoro = {
    id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready', applicazione_finita_il: null,
    results: [
      { product_id: 'p1', patch: { name: 'Buono' } },
      { product_id: 'p2', patch: { name: 'Anche buono' } },
    ],
  };
});

describe('/apply scrive il segno di fine quando il lavoro resta applicato', () => {
  it('applicazione finita: il lavoro e applicato e porta il segno di fine', async () => {
    const { status } = await applica();
    expect(status).toBe(200);
    expect(db.lavoro?.status).toBe('applied');
    expect(db.lavoro?.applicazione_finita_il, 'nessuno ha scritto il segno di fine: l avvio dopo aspetta due minuti').toEqual(expect.any(String));
  });

  it('un salto di passaggio rimette il lavoro pronto: nessun segno di fine', async () => {
    filtro.cadeSu.add('Anche buono');
    const { json } = await applica();
    expect(json.ripetibile).toBe(true);
    expect(db.lavoro?.status).toBe('ready');
    expect(db.lavoro?.applicazione_finita_il).toBeNull();
  });

  it('il lavoro non torna pronto (un altro lavoro avviato intanto): resta applicato, col segno', async () => {
    filtro.cadeSu.add('Anche buono');
    db.rifiutaPronto = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const { json } = await applica();
    expect(json.ripetibile).toBe(false);
    expect(db.lavoro?.status).toBe('applied');
    expect(db.lavoro?.applicazione_finita_il).toEqual(expect.any(String));
  });

  it('categorie illeggibili e lavoro che non torna pronto: anche l uscita anticipata scrive il segno', async () => {
    db.categorieRotte = true;
    db.rifiutaPronto = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const { status } = await applica();
    expect(status).toBe(503);
    expect(db.lavoro?.status).toBe('applied');
    expect(db.lavoro?.applicazione_finita_il).toEqual(expect.any(String));
  });

  it('senza la colonna (migrazione non applicata) l applicazione va avanti come prima', async () => {
    db.colonnaAssente = true;
    const { status, json } = await applica();
    expect(status).toBe(200);
    expect(json.applied).toBe(2);
    expect(db.lavoro?.status).toBe('applied');
  });
});
