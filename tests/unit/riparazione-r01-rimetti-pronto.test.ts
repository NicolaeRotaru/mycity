import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Il «rimetti pronto» dell'applica del lavoro AI sul catalogo. Mentre l'applica
 * gira il lavoro e' «applicato» (chiuso): se nel frattempo il negozio avvia un
 * altro lavoro, il database (un solo lavoro aperto per negozio) rifiuta il
 * ritorno a «pronto» con 23505. Prima l'errore non si leggeva: il lavoro restava
 * chiuso, la risposta diceva «ripetibile» e i saltati pagati non si riprovavano
 * piu', senza che nessuno lo sapesse. Adesso si registra e si dice al negozio.
 */

const db = vi.hoisted(() => ({
  lavoro: null as Record<string, unknown> | null,
  prodotti: [] as Record<string, unknown>[],
  scritture: [] as { id: unknown; valori: Record<string, unknown> }[],
  categorieRotte: false,
  prodottiRotti: false,
  /** L'errore con cui il database rifiuta il ritorno a «pronto» (null = lo accetta). */
  rifiutaPronto: null as { code: string; message: string } | null,
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
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: log }));
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
        // La prenotazione: con .eq('status','ready') tocca la riga solo se e' pronta.
        if (d.filtri.status !== undefined && db.lavoro?.status !== d.filtri.status) return { data: [], error: null };
        // Il ritorno a «pronto»: l'indice del database lo rifiuta se nel frattempo c'e' un altro lavoro aperto.
        if (d.valori?.status === 'ready' && db.rifiutaPronto) return { data: null, error: db.rifiutaPronto };
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

const DUPLICATO = { code: '23505', message: 'duplicate key value violates unique constraint "catalog_ai_jobs_un_lavoro_aperto_per_negozio"' };

beforeEach(() => {
  vi.clearAllMocks();
  db.scritture.length = 0;
  db.categorieRotte = false;
  db.prodottiRotti = false;
  db.rifiutaPronto = null;
  filtro.cadeSu.clear();
  db.prodotti = [prodotto('p1'), prodotto('p2')];
  db.lavoro = {
    id: 'l1', seller_id: 'negozio-1', operation: 'improve', status: 'ready',
    results: [
      { product_id: 'p1', patch: { name: 'Buono' } },
      { product_id: 'p2', patch: { name: 'Filtro giù' } },
    ],
  };
});

const registratoIlRifiuto = () =>
  log.error.mock.calls.some(([messaggio]) => /non rimesso pronto/.test(String(messaggio)));

describe('il «rimetti pronto» che fallisce non si ingoia in silenzio', () => {
  it('un filtro caduto e un altro lavoro avviato nel frattempo: niente «ripetibile», e si dice perche', async () => {
    filtro.cadeSu.add('Filtro giù');
    db.rifiutaPronto = DUPLICATO;
    const { status, json } = await applica();
    expect(status).toBe(200);
    expect(json.applied).toBe(1);
    expect(db.lavoro?.status, 'il database non lo ha rimesso pronto').toBe('applied');
    expect(json.ripetibile, 'prima diceva «ripetibile» a un lavoro rimasto chiuso').toBe(false);
    expect(json.avviso).toMatch(/altro lavoro sul catalogo/);
    const saltato = (json.esiti as { productId: string; esito: string; motivo?: string }[]).find((e) => e.productId === 'p2');
    expect(saltato?.esito).toBe('saltato');
    expect(saltato?.motivo, 'il motivo non dice più «riprova più tardi»').toMatch(/^filtro dei contenuti non disponibile: nel frattempo hai avviato un altro lavoro/);
    expect(registratoIlRifiuto()).toBe(true);
  });

  it('se il rifiuto e un altro guasto, si registra e si dice lo stesso', async () => {
    filtro.cadeSu.add('Filtro giù');
    db.rifiutaPronto = { code: '08006', message: 'connection failure' };
    const { json } = await applica();
    expect(json.ripetibile).toBe(false);
    expect(json.avviso).toMatch(/non sono riuscito a rimettere il lavoro pronto/);
    expect(registratoIlRifiuto()).toBe(true);
  });

  it('categorie illeggibili e «pronto» rifiutato: la risposta non dice «riprova fra poco»', async () => {
    db.categorieRotte = true;
    db.rifiutaPronto = DUPLICATO;
    const { status, json } = await applica();
    expect(status).toBe(503);
    const messaggio = String((json.error as { message?: string } | undefined)?.message ?? '');
    expect(messaggio).toMatch(/altro lavoro sul catalogo/);
    expect(messaggio).not.toMatch(/Riprova fra poco/);
    expect(registratoIlRifiuto()).toBe(true);
  });

  it('catalogo illeggibile e «pronto» rifiutato: lo stesso', async () => {
    db.prodottiRotti = true;
    db.rifiutaPronto = DUPLICATO;
    const { status, json } = await applica();
    expect(status).toBe(503);
    const messaggio = String((json.error as { message?: string } | undefined)?.message ?? '');
    expect(messaggio).toMatch(/altro lavoro sul catalogo/);
    expect(registratoIlRifiuto()).toBe(true);
  });

  it('se il «pronto» passa, tutto come prima: ripetibile, nessun avviso, nessun errore registrato', async () => {
    filtro.cadeSu.add('Filtro giù');
    const { json } = await applica();
    expect(json.ripetibile).toBe(true);
    expect(json.avviso).toBeUndefined();
    expect(db.lavoro?.status).toBe('ready');
    const saltato = (json.esiti as { productId: string; motivo?: string }[]).find((e) => e.productId === 'p2');
    expect(saltato?.motivo).toBe('filtro dei contenuti non disponibile: riprova più tardi');
    expect(registratoIlRifiuto()).toBe(false);
  });
});
