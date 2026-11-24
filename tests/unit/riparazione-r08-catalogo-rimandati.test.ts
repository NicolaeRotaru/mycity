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
  fallisciScrittura: new Set<string>(),
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
const filtro = vi.hoisted(() => ({ chiamati: [] as string[], cade: false }));
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: (p: { name: string; description: string }) =>
    new Promise((ok, ko) => {
      filtro.chiamati.push(p.name);
      setTimeout(
        () => filtro.cade ? ko(new Error('fornitore giu')) : ok(/VIETATO/.test(`${p.name} ${p.description}`) ? { allowed: false, reason: 'vietato' } : { allowed: true }),
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
      if (db.fallisciScrittura.has(d.filtri.id as string)) {
        db.fallisciScrittura.delete(d.filtri.id as string);
        return { data: null, error: { code: 'XX000' } };
      }
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
const BLOCCATI = 50;
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
  db.fallisciScrittura.clear();
  filtro.cade = false;
  db.prodotti = ids.map(prodotto);
});
afterEach(() => vi.useRealTimers());

describe('R08-001 il lavoro rimandato arriva anche in coda, e il filtro non si salta', () => {
  it('50 bloccati in testa su 200 righe, fornitore lento: i bloccati non ripagano, la coda e scritta, il lavoro esce da pronto', async () => {
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: ids.map((id, i) => ({ product_id: id, patch: { name: i < BLOCCATI ? `VIETATO ${i}` : `Nome nuovo ${i}` } })),
    };
    const sonoBloccati = (n: string) => /VIETATO/.test(n);
    const g1 = await applica();
    expect(g1.status).toBe(200);
    expect(g1.json.applied).toBe(0);
    expect(g1.json.ripetibile).toBe(true);
    const primoVerdetto = filtro.chiamati.filter(sonoBloccati).length;
    expect(primoVerdetto, 'il primo giro controlla solo una parte dei bloccati').toBeGreaterThan(0);
    expect(primoVerdetto).toBeLessThan(BLOCCATI);

    let giri = 1;
    while (db.lavoro.status === 'ready' && giri < 10) {
      await applica();
      giri += 1;
    }
    expect(db.lavoro.status, 'il lavoro esce da «pronto»').not.toBe('ready');
    expect(giri, 'in pochi giri').toBeLessThanOrEqual(7);
    expect(ids.slice(BLOCCATI).every((id) => db.scritte.includes(id)), 'tutte le righe pulite sono scritte').toBe(true);
    expect(db.scritte.some((id) => ids.slice(0, BLOCCATI).includes(id as string)), 'un bloccato non si scrive mai').toBe(false);
    // Ogni bloccato paga il filtro una volta sola, dopo il primo verdetto non si ripaga.
    for (let i = 0; i < BLOCCATI; i++) expect(filtro.chiamati.filter((n) => n === `VIETATO ${i}`).length).toBe(1);
  });

  it('una riga pulita con scrittura fallita al primo giro viene scritta al giro dopo, e non e trattata da bloccata', async () => {
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: [
        { product_id: 'p0', patch: { name: 'Pasta nuova' } },
        { product_id: 'p1', patch: { name: 'Sugo nuovo' } },
      ],
    };
    db.fallisciScrittura.add('p0');
    const g1 = await applica(['p0', 'p1']);
    expect(g1.json.applied).toBe(1);
    expect(g1.json.ripetibile).toBe(true);
    expect((db.lavoro.results as Array<Record<string, unknown>>).some((r) => 'filtro_bloccato' in r), 'nessun blocco ricordato').toBe(false);
    expect(db.lavoro.status).toBe('ready');
    const g2 = await applica(['p0', 'p1']);
    expect(db.scritte).toContain('p0');
    expect(g2.json.ripetibile).toBe(false);
  });

  it('un errore o un tempo scaduto del fornitore NON diventa un blocco ricordato', async () => {
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: ids.map((id, i) => ({ product_id: id, patch: { name: `Nome nuovo ${i}` } })),
    };
    filtro.cade = true;
    const g1 = await applica();
    expect(g1.json.ripetibile).toBe(true);
    expect(g1.json.applied).toBe(0);
    expect((db.lavoro.results as Array<Record<string, unknown>>).filter((r) => 'filtro_bloccato' in r), 'un errore del fornitore non e un blocco').toEqual([]);
    filtro.cade = false;
    let giri = 0;
    while (db.lavoro.status === 'ready' && giri < 10) {
      await applica();
      giri += 1;
    }
    expect((db.lavoro.results as Array<Record<string, unknown>>).filter((r) => 'filtro_bloccato' in r)).toEqual([]);
    expect(ids.every((id) => db.scritte.includes(id)), 'tutti sono scritti nei giri dopo').toBe(true);
  });

  it('se la proposta di un bloccato cambia, si rifiltra', async () => {
    db.prodotti = [prodotto('p0', 0)];
    db.lavoro = {
      id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
      results: [{ product_id: 'p0', patch: { name: 'VIETATO uno' } }, { product_id: 'p1', patch: { name: 'Altro nuovo' } }],
    };
    db.prodotti = [prodotto('p0', 0), prodotto('p1', 1)];
    db.fallisciScrittura.add('p1');
    await applica(['p0', 'p1']);
    expect(db.lavoro.status).toBe('ready');
    const chiamatiDopoG1 = filtro.chiamati.length;
    await applica(['p0', 'p1']);
    expect(filtro.chiamati.slice(chiamatiDopoG1), 'p0 e ricordato: solo p1 si rifiltra').toEqual(['Altro nuovo']);
    db.lavoro = { ...db.lavoro, status: 'ready', results: (db.lavoro.results as Array<Record<string, unknown>>).map((r) => (r.product_id === 'p0' ? { ...r, patch: { name: 'VIETATO due' } } : r)) };
    const prima = filtro.chiamati.length;
    await applica(['p0', 'p1']);
    expect(filtro.chiamati.slice(prima)).toContain('VIETATO due');
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
