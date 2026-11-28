/**
 * R04-001 (27/11/2026) — IL RIPENSAMENTO SUI FRESCHI CHE IL NEGOZIO NON HA SPUNTATO.
 *
 * Il blocco di «Ho cambiato idea» scattava sui prodotti spuntati a mano (`non_recedibile`,
 * predefinito false) e su quelli delle categorie dei freschi. Una mozzarella salvata sulla sola
 * radice «Alimentari», senza sottocategoria e senza spunta, ma con «Conservazione: Frigorifero»
 * scritta dal negozio stesso, accettava il ripensamento: HTTP 201, reso nato.
 * Difetto e prodotto sbagliato restano sempre ammessi (garanzia legale).
 *
 * La rotta e' quella vera; la banca dati e' finta e risponde secondo i filtri.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Riga = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'cliente-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: async () => undefined }));

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
      Promise.resolve({ data: righe(), error: null }).then(ok, ko),
  };
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: (t: string) => tavola(t) }),
  getAdminSupabase: () => ({
    from: (t: string) => tavola(t),
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
  }),
}));

import { POST } from '@/app/api/returns/create/route';

const ORDINE = '11111111-1111-4111-8111-111111111111';
const RIGA_A = '22222222-2222-4222-8222-222222222222';
const RIGA_B = '33333333-3333-4333-8333-333333333333';

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

/** Un ordine consegnato ieri, con i prodotti dati. La spunta del negozio non e' mai stata toccata. */
function ordineCon(prodotti: Array<{ id: string; name: string; category_id: string | null; attributes?: Riga }>) {
  db.tabelle.order_items = prodotti.map((p, i) => ({
    id: i === 0 ? RIGA_A : RIGA_B, order_id: ORDINE, product_id: p.id, product_name: p.name,
  }));
  db.tabelle.products = prodotti.map((p) => ({ non_recedibile: false, attributes: {}, ...p }));
}

beforeEach(() => {
  db.tabelle = {
    orders: [{
      id: ORDINE, user_id: 'cliente-1', seller_id: 'negozio-1', delivery_status: 'DELIVERED',
      delivered_at: new Date(Date.now() - 24 * 3600_000).toISOString(), total_price: 9, created_at: new Date().toISOString(),
    }],
    order_items: [],
    products: [],
    categories: [
      { id: 'cat-alimentari', slug: 'alimentari', parent_id: null },
      { id: 'cat-panificio', slug: 'panificio', parent_id: 'cat-alimentari' },
      { id: 'cat-dispensa', slug: 'alimentari-dispensa', parent_id: 'cat-alimentari' },
      { id: 'cat-casa', slug: 'casa', parent_id: null },
    ],
    returns: [],
    notifications: [],
  };
});

describe('R04-001 · «Ho cambiato idea» sui freschi che il negozio non ha spuntato', () => {
  it('un pane del Panificio, spunta mai toccata: rifiutato, nessun reso', async () => {
    ordineCon([{ id: 'pane', name: 'Pane casereccio', category_id: 'cat-panificio' }]);
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status, 'il ripensamento sul pane non spuntato e\' stato accettato').toBe(400);
    expect(await errore(res)).toMatch(/Pane casereccio.*escluso dal recesso/);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('IL CASO CHE ROMPEVA — un fresco da frigorifero sulla sola radice «Alimentari», senza spunta: rifiutato', async () => {
    ordineCon([{ id: 'mozza', name: 'Mozzarella di bufala', category_id: 'cat-alimentari', attributes: { conservazione: 'Frigorifero' } }]);
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status, 'la mozzarella da frigorifero non spuntata e\' passata come ripensamento').toBe(400);
    expect(await errore(res)).toMatch(/Mozzarella di bufala.*escluso dal recesso/);
    expect(db.tabelle.returns).toHaveLength(0);
  });

  it('ordine misto (mozzarella da frigo + miele) per tutto l\'ordine: il reso nasce e la nota lascia fuori la mozzarella', async () => {
    ordineCon([
      { id: 'mozza', name: 'Mozzarella di bufala', category_id: 'cat-alimentari', attributes: { conservazione: 'Frigorifero' } },
      { id: 'miele', name: 'Miele di acacia', category_id: 'cat-dispensa', attributes: { conservazione: 'Temperatura ambiente' } },
    ]);
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    expect(String(db.tabelle.returns[0].notes)).toMatch(/Esclusi dal recesso.*Mozzarella di bufala/);
  });

  it('controprova: un prodotto non fresco per ripensamento si rende', async () => {
    ordineCon([{ id: 'miele', name: 'Miele di acacia', category_id: 'cat-dispensa', attributes: { conservazione: 'Temperatura ambiente' } }]);
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
    expect(db.tabelle.returns[0].notes).toBeNull();
  });

  it('controprova: un surgelato («Freezer») e un prodotto di casa non sono freschi, si rendono', async () => {
    ordineCon([{ id: 'gelato', name: 'Gelato in vaschetta', category_id: 'cat-alimentari', attributes: { conservazione: 'Freezer' } }]);
    expect((await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }))).status).toBe(201);
    db.tabelle.returns = [];
    ordineCon([{ id: 'tazza', name: 'Tazza in ceramica', category_id: 'cat-casa' }]);
    expect((await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }))).status).toBe(201);
  });

  it('controprova: il pane arrivato ammuffito si rende sempre (garanzia)', async () => {
    ordineCon([{ id: 'pane', name: 'Pane casereccio', category_id: 'cat-panificio' }]);
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'DAMAGED' }));
    expect(res.status).toBe(201);
    expect(db.tabelle.returns).toHaveLength(1);
  });

  it('controprova: la mozzarella da frigo sbagliata si rende sempre', async () => {
    ordineCon([{ id: 'mozza', name: 'Mozzarella di bufala', category_id: 'cat-alimentari', attributes: { conservazione: 'Frigorifero' } }]);
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'WRONG_ITEM' }));
    expect(res.status).toBe(201);
  });
});
