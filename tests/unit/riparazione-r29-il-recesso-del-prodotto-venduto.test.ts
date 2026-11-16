/**
 * R29-020 — IL NEGOZIO POTEVA TOGLIERE IL DIRITTO DI RESO A UN PRODOTTO GIA' VENDUTO.
 *
 * La rotta dei resi leggeva «escluso dal recesso» dal prodotto com'e' adesso: il negozio lo
 * spuntava dopo la vendita e il cliente si vedeva rifiutare il ripensamento su un miele comprato
 * quando il reso era ammesso. Adesso decide la copia sulla riga d'ordine scritta dal database alla
 * vendita (`order_items.non_recedibile`, migrazione 530, provata in
 * tests/sql/rls/riparazione-r29-il-recesso-del-prodotto-venduto.test.sql); il prodotto di adesso
 * conta solo per le righe senza copia (righe antiche, o la 530 non ancora applicata).
 *
 * La rotta e' quella vera; la banca dati e' finta e risponde secondo i filtri. Dati finti.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Riga = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  errori: {} as Record<string, unknown>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'cliente-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));

function tavola(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  const righe = () => (db.tabelle[nome] ?? []).filter((r) => filtri.every((f) => f(r)));
  const c: Record<string, unknown> = {
    select: () => c,
    eq: (k: string, v: unknown) => (filtri.push((r) => r[k] === v), c),
    in: (k: string, vs: unknown[]) => (filtri.push((r) => vs.includes(r[k])), c),
    limit: () => c,
    order: () => c,
    single: async () => ({ data: righe()[0] ?? null, error: righe()[0] ? null : { message: 'nessuna riga' } }),
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    insert: (v: Riga) => {
      const riga = { id: `ret-${(db.tabelle[nome] ?? []).length + 1}`, ...v };
      (db.tabelle[nome] ??= []).push(riga);
      const fatto = { data: { id: riga.id }, error: null };
      return { select: () => ({ single: async () => fatto }), then: (ok: (r: unknown) => unknown) => Promise.resolve(fatto).then(ok) };
    },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(db.errori[nome] ? { data: null, error: db.errori[nome] } : { data: righe(), error: null }).then(ok, ko),
  };
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: (t: string) => tavola(t) }),
  getAdminSupabase: () => ({ from: (t: string) => tavola(t) }),
}));

import { POST } from '@/app/api/returns/create/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RIGA_TORTA = '22222222-2222-4222-8222-222222222222';
const RIGA_MIELE = '33333333-3333-4333-8333-333333333333';

function richiesta(corpo: Riga): never {
  return new Request('http://localhost/api/returns/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

beforeEach(() => {
  db.errori = {};
  db.tabelle = {
    orders: [{
      id: ORDINE, user_id: 'cliente-1', seller_id: 'pane-quotidiano', delivery_status: 'DELIVERED',
      delivered_at: new Date(Date.now() - 24 * 3600_000).toISOString(), total_price: 31, created_at: new Date().toISOString(),
    }],
    order_items: [
      { id: RIGA_TORTA, order_id: ORDINE, product_id: 'torta' },
      { id: RIGA_MIELE, order_id: ORDINE, product_id: 'miele' },
    ],
    products: [
      { id: 'torta', name: 'Torta di compleanno', non_recedibile: true },
      { id: 'miele', name: 'Miele di acacia', non_recedibile: false },
    ],
    returns: [],
    notifications: [],
  };
});

async function errore(res: Response): Promise<string> {
  const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
  return typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '');
}


describe('R29-020 — il recesso si decide sul prodotto com era quando e stato venduto', () => {
  it('il miele venduto recedibile, escluso dal negozio dopo: il ripensamento passa', async () => {
    db.tabelle.products = [{ id: 'miele', name: 'Miele di acacia', non_recedibile: true }];
    db.tabelle.order_items = [{ id: RIGA_MIELE, order_id: ORDINE, product_id: 'miele', product_name: 'Miele di acacia', non_recedibile: false }];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status, 'il negozio ha tolto il recesso a un prodotto gia venduto').toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
    expect(db.tabelle.returns[0].notes).toBeNull();
  });

  it('la torta venduta esclusa, liberata dal negozio dopo: resta esclusa', async () => {
    db.tabelle.products = [{ id: 'torta', name: 'Torta di compleanno', non_recedibile: false }];
    db.tabelle.order_items = [{ id: RIGA_TORTA, order_id: ORDINE, product_id: 'torta', product_name: 'Torta di compleanno', non_recedibile: true }];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(await errore(res)).toMatch(/Torta di compleanno.*escluso dal recesso/);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('con la copia su ogni riga il prodotto di adesso non serve: anche se non si legge, si decide', async () => {
    db.errori.products = { code: '08006', message: 'connessione caduta' };
    db.tabelle.order_items = [{ id: RIGA_MIELE, order_id: ORDINE, product_id: 'miele', product_name: 'Miele di acacia', non_recedibile: false }];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
  });

  it('una riga antica senza copia conta ancora come il prodotto: ordine misto, il reso nasce con la nota', async () => {
    db.tabelle.products = [
      { id: 'torta', name: 'Torta di compleanno', non_recedibile: true },
      { id: 'miele', name: 'Miele di acacia', non_recedibile: true },
    ];
    db.tabelle.order_items = [
      { id: RIGA_TORTA, order_id: ORDINE, product_id: 'torta' },
      { id: RIGA_MIELE, order_id: ORDINE, product_id: 'miele', product_name: 'Miele di acacia', non_recedibile: false },
    ];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    const note = String(db.tabelle.returns[0].notes);
    expect(note).toMatch(/Esclusi dal recesso.*Torta di compleanno/);
    expect(note).not.toMatch(/Miele/);
  });
});
