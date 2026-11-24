import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Il filtro di conformita' dei prodotti ha un tempo suo (10 s, lib/ai/moderation.ts), ma
 * l'applica del lavoro AI sul catalogo lo chiama a gruppi di 5 su fino a 200 righe: 40 gruppi
 * in fila. Con un fornitore lento (qui: ogni filtro risponde dopo 9,5 s, appena sotto il suo
 * tempo) si arrivava a 380 s, ben oltre i 120 s della rotta: Vercel la spegneva, niente scritto,
 * filtri gia' pagati. Adesso dopo 70 s nessun gruppo nuovo parte: chi e' rimasto fuori non si
 * scrive, si dice («non controllato in tempo: rimandalo») e il lavoro torna pronto; rimandato,
 * riparte da chi era rimasto fuori.
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

// Il fornitore lento: ogni controllo risponde «conforme» dopo 9,5 s.
const filtro = vi.hoisted(() => ({ chiamati: [] as string[] }));
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: (p: { name: string }) =>
    new Promise((ok) => {
      filtro.chiamati.push(p.name);
      setTimeout(() => ok({ allowed: true }), 9_500);
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
const ids = Array.from({ length: RIGHE }, (_, i) => `p${i}`);
const prodotto = (id: string, i: number) => ({
  id, seller_id: 'negozio-1', name: `Prodotto ${i}`, description: 'Una descrizione abbastanza lunga.',
  price: 5, compare_at_price: null, unit: 'pezzo', condition: 'nuovo', stock: 3, status: 'available',
  images: ['https://mycity.test/f.jpg'], tags: [], has_variants: false, category_id: 'casa', attributes: {},
});

type Risposta = { status: number; json: Record<string, unknown>; durataMs: number };

/** Lancia l'applica e fa scorrere al massimo i 120 s della rotta: se non ha risposto, torna null. */
const applicaEntroLaRotta = async (): Promise<Risposta | null> => {
  const inizio = Date.now();
  let risposta: Risposta | null = null;
  const p = POST(
    new Request('http://localhost/api/ai/catalog-batch/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: 'l1', productIds: ids }),
    }) as never,
  ).then(async (res) => {
    risposta = { status: res.status, json: (await res.json()) as Record<string, unknown>, durataMs: Date.now() - inizio };
  });
  for (let t = 0; t < 120_000 && !risposta; t += 500) await vi.advanceTimersByTimeAsync(500);
  if (!risposta) {
    // Vercel l'avrebbe gia' spenta: si lascia finire solo per non lasciare la prova appesa.
    await vi.advanceTimersByTimeAsync(400_000);
    await p;
    return null;
  }
  return risposta;
};

type Esito = { productId: string; esito: string; motivo?: string };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
  filtro.chiamati.length = 0;
  db.scritte.length = 0;
  db.prodotti = ids.map(prodotto);
  db.lavoro = {
    id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
    results: ids.map((id, i) => ({ product_id: id, patch: { name: `Nome nuovo ${i}` } })),
  };
});
afterEach(() => vi.useRealTimers());

describe('l applica del lavoro sul catalogo sta nei 120 s anche con il filtro lento', () => {
  it('200 righe: risponde prima dei 120 s, chi e rimasto fuori non si scrive e si rimanda', async () => {
    const r = await applicaEntroLaRotta();
    expect(r, 'prima: 40 gruppi da 9,5 s, a 120 s la rotta era ancora al filtro').not.toBeNull();
    expect(r!.status).toBe(200);
    expect(r!.durataMs).toBeLessThan(120_000);

    // Partono gruppi solo fino a 70 s: 8 gruppi da 5.
    expect(filtro.chiamati).toHaveLength(40);
    expect(r!.json.applied).toBe(40);
    const esiti = r!.json.esiti as Esito[];
    const rimandati = esiti.filter((e) => e.motivo === 'non controllato in tempo: rimandalo');
    expect(rimandati).toHaveLength(160);
    expect(rimandati.every((e) => e.esito === 'saltato')).toBe(true);
    // Chi non e' stato controllato non si scrive.
    expect(new Set(db.scritte)).toEqual(new Set(ids.slice(0, 40)));
    expect(db.prodotti.slice(40).every((p) => String(p.name).startsWith('Prodotto '))).toBe(true);
    // E il lavoro torna pronto, per rimandarlo.
    expect(r!.json.ripetibile).toBe(true);
    expect(db.lavoro?.status).toBe('ready');
  });

  it('rimandato, riparte da chi era rimasto fuori e alla fine chiude il lavoro', async () => {
    const prima = await applicaEntroLaRotta();
    expect(prima).not.toBeNull();
    filtro.chiamati.length = 0;

    const seconda = await applicaEntroLaRotta();
    expect(seconda).not.toBeNull();
    // I 40 gia' scritti non si rifiltrano: tocca ai 40 dopo.
    expect(filtro.chiamati).toEqual(ids.slice(40, 80).map((_, i) => `Nome nuovo ${40 + i}`));
    expect(seconda!.json.applied).toBe(80);
    expect(seconda!.json.ripetibile).toBe(true);

    let ultima = seconda!;
    for (let giro = 0; giro < 5 && ultima.json.ripetibile; giro++) {
      const r = await applicaEntroLaRotta();
      expect(r).not.toBeNull();
      ultima = r!;
    }
    expect(ultima.json.ripetibile).toBe(false);
    expect(ultima.json.applied).toBe(RIGHE);
    expect(db.lavoro?.status).toBe('applied');
    expect(db.prodotti.every((p, i) => p.name === `Nome nuovo ${i}`)).toBe(true);
  });
});
