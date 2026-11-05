import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * S10 (5/11/2026) — «Applica a tutti» del lavoro massivo sul catalogo.
 * 1858/1667: la risposta dice chi è stato saltato e perché.
 * 1635: se manca qualcosa solo per il cambio di categoria, il resto si scrive.
 * 1859: il filtro non parte con duecento chiamate insieme.
 * 1860: due «Applica» insieme: passa uno solo.
 * 1770: «Traduci» resta fermo anche limitato alla selezione.
 */

const db = vi.hoisted(() => ({
  lavoro: null as Record<string, unknown> | null,
  prodotti: [] as Record<string, unknown>[],
  scritture: [] as { id: unknown; valori: Record<string, unknown> }[],
  prodottiRotti: false,
  categorie: [
    { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
    { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
  ],
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

const filtro = vi.hoisted(() => ({ inCorso: 0, massimo: 0, cadeSu: new Set<string>(), negaSu: new Set<string>() }));
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: async (p: { name: string }) => {
    filtro.inCorso++;
    filtro.massimo = Math.max(filtro.massimo, filtro.inCorso);
    await new Promise((r) => setTimeout(r, 1));
    filtro.inCorso--;
    if (filtro.cadeSu.has(p.name)) throw new Error('429');
    if (filtro.negaSu.has(p.name)) return { allowed: false, reason: 'contenuto vietato' };
    return { allowed: true };
  },
}));

vi.mock('@/lib/supabase/server', () => {
  type D = { op: 'select' | 'update'; valori: Record<string, unknown> | null; filtri: Record<string, unknown> };
  const risolvi = (tabella: string, d: D, una: boolean) => {
    if (tabella === 'categories') return { data: db.categorie, error: null };
    if (tabella === 'catalog_ai_jobs') {
      if (d.op === 'update') {
        // Update condizionato: con .eq('status','ready') tocca la riga solo se è pronta.
        if (d.filtri.status !== undefined && db.lavoro?.status !== d.filtri.status) return { data: [], error: null };
        db.lavoro = { ...db.lavoro, ...d.valori };
        return { data: [{ id: db.lavoro.id }], error: null };
      }
      return { data: db.lavoro ? { ...db.lavoro } : null, error: null };
    }
    if (d.op === 'update') {
      db.scritture.push({ id: d.filtri.id, valori: d.valori ?? {} });
      return { data: null, error: null };
    }
    if (db.prodottiRotti) return { data: null, error: { message: 'timeout' } };
    return { data: una ? null : db.prodotti, error: null };
  };
  const tabella = (nome: string) => {
    const d: D = { op: 'select', valori: null, filtri: {} };
    const q = {
      select: () => q,
      order: () => q,
      in: () => q,
      eq: (c: string, v: unknown) => {
        d.filtri[c] = v;
        return q;
      },
      update: (v: Record<string, unknown>) => {
        d.op = 'update';
        d.valori = v;
        return q;
      },
      single: async () => risolvi(nome, d, true),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risolvi(nome, d, false)).then(ok, ko),
    };
    return q;
  };
  return { getAdminSupabase: () => ({ from: tabella }) };
});

import { POST } from '@/app/api/ai/catalog-batch/apply/route';

const prodotto = (id: string, over: Record<string, unknown> = {}) => ({
  id, seller_id: 'negozio-1', name: `Prodotto ${id}`, description: 'Una descrizione abbastanza lunga.',
  price: 5, compare_at_price: null, unit: 'pezzo', condition: 'nuovo', stock: 3, status: 'available',
  images: ['https://mycity.test/f.jpg'], tags: [], has_variants: false, category_id: 'casa', attributes: {}, ...over,
});

const applica = async (corpo: Record<string, unknown> = { jobId: 'l1' }) => {
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-batch/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }) as never,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  db.scritture.length = 0;
  filtro.inCorso = 0;
  filtro.massimo = 0;
  filtro.cadeSu.clear();
  filtro.negaSu.clear();
  db.prodottiRotti = false;
});

describe('il lavoro massivo dice chi ha saltato e perché (1858, 1667)', () => {
  it('bloccato dal filtro e filtro caduto hanno ciascuno il suo motivo, e il lavoro resta ripetibile', async () => {
    db.prodotti = [prodotto('p1'), prodotto('p2'), prodotto('p3')];
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: [
        { product_id: 'p1', patch: { name: 'Buono' } },
        { product_id: 'p2', patch: { name: 'Vietato' } },
        { product_id: 'p3', patch: { name: 'Filtro giù' } },
      ],
    };
    filtro.negaSu.add('Vietato');
    filtro.cadeSu.add('Filtro giù');
    const { status, json } = await applica();
    expect(status).toBe(200);
    expect(json.applied).toBe(1);
    const esiti = json.esiti as { productId: string; esito: string; motivo?: string }[];
    expect(esiti.find((e) => e.productId === 'p2')).toMatchObject({ esito: 'saltato', motivo: expect.stringMatching(/bloccato dal filtro/) });
    expect(esiti.find((e) => e.productId === 'p3')).toMatchObject({ esito: 'saltato', motivo: expect.stringMatching(/non disponibile/) });
    expect(json.ripetibile).toBe(true);
    expect(db.lavoro?.status).toBe('ready');
  });
});

describe('un cambio di categoria che non si può fare non butta il resto (1635)', () => {
  it('il nome migliorato si scrive, la categoria resta quella', async () => {
    db.prodotti = [prodotto('p1')];
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: [{ product_id: 'p1', patch: { name: 'Miele di acacia', category_slug: 'alimentari' } }],
    };
    const { json } = await applica();
    expect(db.scritture).toHaveLength(1);
    expect(db.scritture[0].valori).toMatchObject({ name: 'Miele di acacia' });
    expect(db.scritture[0].valori).not.toHaveProperty('category_id');
    const esiti = json.esiti as { esito: string; motivo?: string }[];
    expect(esiti[0]).toMatchObject({ esito: 'applicato', motivo: expect.stringMatching(/categoria non cambiata/) });
  });
});

describe('il filtro non parte con tutte le chiamate insieme (1859)', () => {
  it('con 40 prodotti al massimo 5 controlli contemporanei', async () => {
    db.prodotti = Array.from({ length: 40 }, (_, i) => prodotto(`p${i}`));
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: db.prodotti.map((p) => ({ product_id: p.id, patch: { name: `${p.name} nuovo` } })),
    };
    await applica();
    expect(filtro.massimo).toBeLessThanOrEqual(5);
    expect(db.scritture).toHaveLength(40);
  });
});

describe('due «Applica» insieme: passa uno solo (1860)', () => {
  it('la seconda richiesta trova il lavoro già preso', async () => {
    db.prodotti = [prodotto('p1')];
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: [{ product_id: 'p1', patch: { name: 'Nuovo nome' } }],
    };
    const [a, b] = await Promise.all([applica(), applica()]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(db.scritture).toHaveLength(1);
  });
});

describe('«Traduci» resta fermo anche sulla selezione (1770)', () => {
  it('lavoro translate con productIds: 400 e nessuna scrittura', async () => {
    db.prodotti = [prodotto('p1')];
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'translate', status: 'ready',
      results: [{ product_id: 'p1', patch: { name: 'Bread' } }],
    };
    const { status } = await applica({ jobId: 'l1', productIds: ['p1'] });
    expect(status).toBe(400);
    expect(db.scritture).toHaveLength(0);
  });
});

describe('una lettura caduta non brucia il lavoro (revisione)', () => {
  it('catalogo illeggibile: 503, nessuna scrittura, il lavoro resta «pronto»', async () => {
    db.prodotti = [prodotto('p1')];
    db.prodottiRotti = true;
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: [{ product_id: 'p1', patch: { name: 'Nuovo' } }],
    };
    const { status } = await applica();
    expect(status).toBe(503);
    expect(db.scritture).toHaveLength(0);
    expect(db.lavoro?.status).toBe('ready');
  });
});
