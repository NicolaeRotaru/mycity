/**
 * 31/10/2026 (sesta ondata, secondo giro) — UN PRODOTTO TOLTO DAL CATALOGO NON
 * TOGLIE IL RECESSO A TUTTO L'ORDINE.
 *
 * Il collaudo ha trovato la variante scomoda: torta (esclusa dal recesso) +
 * miele, ma il miele e' stato tolto dal catalogo dopo l'ordine (la riga ha
 * `product_id` NULL, o la riga di `products` e' cancellata). La rotta contava
 * solo i prodotti trovati: restava la torta da sola, «tutti esclusi», e il
 * «Cambio idea» su tutto l'ordine si rifiutava. Ora si conta una riga per
 * prodotto: quella senza prodotto vale come recedibile, il reso nasce e la
 * torta resta fuori dal rimborso.
 *
 * La rotta e' quella vera; la banca dati e' finta e risponde secondo i filtri.
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

describe('«Cambio idea» quando un prodotto dell\'ordine e\' stato tolto dal catalogo', () => {
  it('IL CASO CHE ROMPEVA — la torta del forno per ripensamento: rifiutata, e nessun reso nasce', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(await errore(res)).toMatch(/Torta di compleanno.*escluso dal recesso/);
    expect(db.tabelle.returns, 'il reso per ripensamento sulla torta e\' nato').toHaveLength(0);
  });

  /**
   * 31/10/2026 (collaudo) — UNA TORTA ESCLUSA NON TOGLIE IL RECESSO AL MIELE.
   * La pagina dei resi non fa scegliere la riga: chiede il reso di tutto
   * l'ordine. Rifiutarlo intero perche' dentro c'e' la torta toglieva il
   * ripensamento anche al miele, che ce l'ha. Il reso nasce, e la nota dice al
   * negozio di lasciare fuori la torta dal rimborso (l'importo lo sceglie lui).
   */
  it('IL CASO CHE ROMPEVA — tutto l\'ordine per ripensamento, torta + miele: il reso nasce, la torta resta fuori', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND', notes: 'Il miele non mi piace' }));
    expect(res.status, 'il ripensamento sul miele e\' stato rifiutato per colpa della torta').toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
    const note = String(db.tabelle.returns[0].notes);
    expect(note).toMatch(/^Il miele non mi piace/);
    expect(note).toMatch(/Esclusi dal recesso.*Torta di compleanno/);
    expect(note).not.toMatch(/Miele/);
  });

  it('tutto l\'ordine per ripensamento, ma ogni prodotto e\' escluso: rifiutato', async () => {
    db.tabelle.order_items = [{ id: RIGA_TORTA, order_id: ORDINE, product_id: 'torta' }];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('controprova: il ripensamento su un ordine senza esclusi non si porta dietro nessuna nota', async () => {
    db.tabelle.order_items = [{ id: RIGA_MIELE, order_id: ORDINE, product_id: 'miele' }];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns[0].notes).toBeNull();
  });

  it('se i prodotti non si leggono non si decide al buio: errore, nessun reso', async () => {
    db.errori.products = { code: '08006', message: 'connessione caduta' };
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(500);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('controprova: la torta arrivata rovinata si rende sempre (garanzia)', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'DAMAGED' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
  });

  it('controprova: il miele per ripensamento si rende', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_MIELE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
  });

  it('controprova: prima della migrazione 180 (riga senza la colonna) il ripensamento resta possibile', async () => {
    db.tabelle.products = [{ id: 'torta', name: 'Torta di compleanno' }, { id: 'miele', name: 'Miele di acacia' }];
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
  });
  it('VARIANTE COLLAUDO — torta + miele, ma il miele e\' stato tolto dal catalogo (product_id NULL): il miele non perde il recesso', async () => {
    db.tabelle.order_items = [
      { id: RIGA_TORTA, order_id: ORDINE, product_id: 'torta' },
      { id: RIGA_MIELE, order_id: ORDINE, product_id: null },
    ];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND', notes: 'Il miele non mi piace' }));
    expect(res.status, 'ripensamento rifiutato su tutto l\'ordine: la riga del miele (prodotto tolto dal catalogo) non conta').toBe(201);
  });

  it('IL CASO CHE ROMPEVA — il miele tolto dal catalogo (product_id NULL) conta come recedibile, la nota esclude solo la torta', async () => {
    db.tabelle.order_items = [
      { id: RIGA_TORTA, order_id: ORDINE, product_id: 'torta', product_name: 'Torta di compleanno' },
      { id: RIGA_MIELE, order_id: ORDINE, product_id: null, product_name: 'Miele di acacia' },
    ];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    const note = String(db.tabelle.returns[0].notes);
    expect(note).toMatch(/Esclusi dal recesso.*Torta di compleanno/);
    expect(note).not.toMatch(/Miele/);
  });

  it('IL CASO CHE ROMPEVA — la riga del miele punta a un prodotto cancellato: non vale come «escluso»', async () => {
    db.tabelle.products = [{ id: 'torta', name: 'Torta di compleanno', non_recedibile: true }];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status, 'il prodotto non trovato e\' stato contato come escluso').toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
  });

  it('controprova: la sola torta, con accanto una riga senza prodotto, per riga singola resta rifiutata', async () => {
    db.tabelle.order_items = [
      { id: RIGA_TORTA, order_id: ORDINE, product_id: 'torta' },
      { id: RIGA_MIELE, order_id: ORDINE, product_id: null },
    ];
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_TORTA, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(db.tabelle.returns).toHaveLength(0);
  });
});
