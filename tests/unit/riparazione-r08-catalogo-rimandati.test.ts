import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R08-001. Il lavoro sul catalogo si «rimanda» a chi non e' stato controllato in tempo, ma chi e'
 * bloccato dal filtro non si scrive, il suo testo resta diverso da quello in catalogo e a ogni giro
 * veniva rifiltrato (e ripagato) per primo: con il fornitore lento e circa 40 bloccati in testa la
 * coda non veniva mai controllata. E un testo vietato gia' in catalogo, ripetuto dalla proposta con
 * tag nuovi, scriveva i tag senza passare dal filtro.
 */

const db = vi.hoisted(() => ({
  lavoro: null as Record<string, unknown> | null,
  prodotti: [] as Record<string, unknown>[],
  scritte: [] as unknown[],
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

// Il fornitore lento: ogni controllo risponde dopo 9,5 s; i nomi che contengono VIETATO sono negati.
const filtro = vi.hoisted(() => ({ chiamati: [] as string[] }));
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: (p: { name: string; description: string }) =>
    new Promise((ok) => {
      filtro.chiamati.push(p.name);
      setTimeout(
        () => ok(/VIETATO/.test(`${p.name} ${p.description}`) ? { allowed: false, reason: 'vietato' } : { allowed: true }),
        9_500,
      );
    }),
}));

vi.mock('@/lib/supabase/server', () => {
  type D = { op: 'select' | 'update'; valori: Record<string, unknown> | null; filtri: Record<string, unknown> };
  const risolvi = (tabella: string, d: D, una: boolean) => {
    if (tabella === 'categories') return { data: [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }], error: null };
    if (tabella === 'catalog_ai_jobs') {
      if (d.op === 'update') {
        if (d.filtri.status !== undefined && db.lavoro?.status !== d.filtri.status) return { data: [], error: null };
        db.lavoro = { ...db.lavoro, ...d.valori };
        return { data: [{ id: db.lavoro.id }], error: null };
      }
      return { data: db.lavoro ? { ...db.lavoro } : null, error: null };
    }
    if (d.op === 'update') {
      db.scritte.push(d.filtri.id);
      db.prodotti = db.prodotti.map((p) => (p.id === d.filtri.id ? { ...p, ...d.valori } : p));
      return { data: null, error: null };
    }
    return { data: una ? null : db.prodotti.map((p) => ({ ...p })), error: null };
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

const RIGHE = 200;
const BLOCCATI = 40;
const ids = Array.from({ length: RIGHE }, (_, i) => `p${i}`);
const prodotto = (id: string, i: number) => ({
  id, seller_id: 'negozio-1', name: `Prodotto ${i}`, description: 'Una descrizione abbastanza lunga.',
  price: 5, compare_at_price: null, unit: 'pezzo', condition: 'nuovo', stock: 3, status: 'available',
  images: ['https://mycity.test/f.jpg'], tags: [], has_variants: false, category_id: 'casa', attributes: {},
});

type Risposta = { status: number; json: Record<string, unknown> };

const applica = async (productIds: string[] = ids): Promise<Risposta> => {
  let risposta: Risposta | null = null;
  const p = POST(
    new Request('http://localhost/api/ai/catalog-batch/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: 'l1', productIds }),
    }) as never,
  ).then(async (res) => {
    risposta = { status: res.status, json: (await res.json()) as Record<string, unknown> };
  });
  for (let t = 0; t < 120_000 && !risposta; t += 500) await vi.advanceTimersByTimeAsync(500);
  await vi.advanceTimersByTimeAsync(400_000);
  await p;
  return risposta as unknown as Risposta;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
  filtro.chiamati.length = 0;
  db.scritte.length = 0;
  db.prodotti = ids.map(prodotto);
});
afterEach(() => vi.useRealTimers());

describe('R08-001 il lavoro rimandato arriva anche in coda, e il filtro non si salta', () => {
  it('40 bloccati in testa su 200 righe, fornitore lento: dopo pochi giri la coda e controllata e scritta', async () => {
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: ids.map((id, i) => ({ product_id: id, patch: { name: i < BLOCCATI ? `VIETATO ${i}` : `Nome nuovo ${i}` } })),
    };
    const scrittiDa = (da: number, a: number) => ids.slice(da, a).every((id) => db.scritte.includes(id));

    const g1 = await applica();
    expect(g1.status).toBe(200);
    expect(g1.json.applied).toBe(0); // i primi 40 (tutti bloccati) consumano il giro
    expect(g1.json.ripetibile).toBe(true);

    const g2 = await applica();
    expect(g2.json.applied, 'al secondo giro i bloccati si ripagano e la coda non avanza').toBe(40);
    await applica();
    await applica();
    const g5 = await applica();
    expect(g5.json.applied).toBe(RIGHE - BLOCCATI);
    expect(scrittiDa(BLOCCATI, RIGHE), 'dopo pochi giri la coda e controllata e scritta').toBe(true);
    expect(db.scritte.some((id) => ids.slice(0, BLOCCATI).includes(id as string)), 'un bloccato non si scrive mai').toBe(false);
  });

  it('un testo vietato gia in catalogo, ripetuto con tag nuovi, passa dal filtro e non scrive i tag', async () => {
    db.prodotti = [{ ...prodotto('p0', 0), name: 'Pasta VIETATO', tags: [] }];
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: [{ product_id: 'p0', patch: { name: 'Pasta VIETATO', tags: ['pasta', 'bio'] } }],
    };
    const r = await applica(['p0']);
    expect(r.status).toBe(200);
    expect(filtro.chiamati, 'i tag nuovi si scrivevano senza filtro').toEqual(['Pasta VIETATO']);
    expect(db.scritte).toEqual([]);
    expect(r.json.applied).toBe(0);
  });

  it('CONTROLLO: un testo uguale al catalogo e nessun altro cambiamento non si rifiltra', async () => {
    db.prodotti = [{ ...prodotto('p0', 0), name: 'Pasta buona', tags: ['pasta', 'bio'] }];
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: [{ product_id: 'p0', patch: { name: 'Pasta buona', tags: ['pasta', 'bio'] } }],
    };
    await applica(['p0']);
    expect(filtro.chiamati).toEqual([]);
  });
});
