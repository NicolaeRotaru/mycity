/**
 * R21-001 (26/11/2026) — IL PANE NON SPUNTATO NON SI RENDE PER «HO CAMBIATO IDEA».
 *
 * Il blocco del ripensamento scattava solo sui prodotti che il negozio segna a mano
 * (`products.non_recedibile`, migrazione 180, predefinito false). Un pane creato senza
 * toccare la spunta passava: «Cambio idea» → HTTP 201, reso nato. Il fatto
 * `legale.recesso-esclusi` dice che pane, dolci, salumi, latticini e gli altri freschi
 * sono esclusi dal recesso: la categoria del prodotto (Panificio, Salumeria, …) lo sa
 * anche quando la spunta manca.
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
const RIGA_PANE = '22222222-2222-4222-8222-222222222222';
const RIGA_MIELE = '33333333-3333-4333-8333-333333333333';

function richiesta(corpo: Riga): never {
  return new Request('http://localhost/api/returns/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

async function errore(res: Response): Promise<string> {
  const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
  return typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '');
}

beforeEach(() => {
  db.errori = {};
  db.tabelle = {
    orders: [{
      id: ORDINE, user_id: 'cliente-1', seller_id: 'pane-quotidiano', delivery_status: 'DELIVERED',
      delivered_at: new Date(Date.now() - 24 * 3600_000).toISOString(), total_price: 9, created_at: new Date().toISOString(),
    }],
    order_items: [
      { id: RIGA_PANE, order_id: ORDINE, product_id: 'pane', product_name: 'Pane casereccio' },
      { id: RIGA_MIELE, order_id: ORDINE, product_id: 'miele', product_name: 'Miele di acacia' },
    ],
    // Il forno non ha toccato la spunta: non_recedibile resta false, come la crea il modulo.
    products: [
      { id: 'pane', name: 'Pane casereccio', non_recedibile: false, category_id: 'cat-panificio' },
      { id: 'miele', name: 'Miele di acacia', non_recedibile: false, category_id: 'cat-dispensa' },
    ],
    categories: [
      { id: 'cat-alimentari', slug: 'alimentari', parent_id: null },
      { id: 'cat-panificio', slug: 'panificio', parent_id: 'cat-alimentari' },
      { id: 'cat-pane-speciale', slug: 'pane-di-segale', parent_id: 'cat-panificio' },
      { id: 'cat-latticini', slug: 'alimentari-latticini', parent_id: 'cat-alimentari' },
      { id: 'cat-dispensa', slug: 'alimentari-dispensa', parent_id: 'cat-alimentari' },
    ],
    returns: [],
    notifications: [],
  };
});

describe('R21-001 · «Ho cambiato idea» su un pane che il forno non ha spuntato', () => {
  it('IL CASO CHE ROMPEVA — il pane del Panificio, spunta mai toccata: rifiutato, nessun reso', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_PANE, reason: 'CHANGED_MIND' }));
    expect(res.status, 'il ripensamento sul pane non spuntato e\' stato accettato').toBe(400);
    expect(await errore(res)).toMatch(/Pane casereccio.*escluso dal recesso/);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('un ordine di solo pane, chiesto per tutto l\'ordine: rifiutato', async () => {
    db.tabelle.order_items = [{ id: RIGA_PANE, order_id: ORDINE, product_id: 'pane', product_name: 'Pane casereccio' }];
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('una sottocategoria del Panificio creata dal pannello vale come il Panificio', async () => {
    db.tabelle.products[0].category_id = 'cat-pane-speciale';
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_PANE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('anche gli altri freschi del fatto (latticini) non spuntati: rifiutati', async () => {
    db.tabelle.products[0] = { id: 'pane', name: 'Mozzarella', non_recedibile: false, category_id: 'cat-latticini' };
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_PANE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('prima della migrazione 180 (riga senza la colonna) il pane del Panificio resta escluso', async () => {
    db.tabelle.products = [
      { id: 'pane', name: 'Pane casereccio', category_id: 'cat-panificio' },
      { id: 'miele', name: 'Miele di acacia', category_id: 'cat-dispensa' },
    ];
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_PANE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(400);
  });

  it('pane + miele per tutto l\'ordine: il reso nasce, e la nota dice al negozio di lasciare fuori il pane', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
    const nota = String(db.tabelle.returns[0].notes);
    expect(nota, 'il negozio non sa che il pane non va rimborsato').toMatch(/Esclusi dal recesso.*Pane casereccio/);
    expect(nota).not.toMatch(/Miele/);
  });

  it('se le categorie non si leggono non si decide al buio: errore, nessun reso', async () => {
    db.errori.categories = { code: '08006', message: 'connessione caduta' };
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_PANE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(500);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('controprova: il pane arrivato ammuffito si rende sempre (garanzia)', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_PANE, reason: 'DAMAGED' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
  });

  it('controprova: il miele della dispensa per ripensamento si rende', async () => {
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_MIELE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns[0].notes).toBeNull();
  });

  it('controprova: un prodotto senza categoria per ripensamento si rende', async () => {
    db.tabelle.products[0].category_id = null;
    const res = await POST(richiesta({ orderId: ORDINE, orderItemId: RIGA_PANE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
  });
});
