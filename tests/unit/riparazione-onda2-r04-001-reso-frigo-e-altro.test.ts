/**
 * R04-001 (onda 2, 28/11/2026) — IL FRESCO DA FRIGO SCRITTO A MANO, E «ALTRO» SUL PANE.
 *
 * (a) La rotta riconosceva solo «Conservazione: Frigorifero» esatto, con la chiave minuscola. Il
 *     caricamento da file scrive testo libero: «In frigorifero», «Frigo» o la chiave «Conservazione»
 *     passavano come ripensamento (201). Resta fuori «in frigorifero dopo l'apertura» (dispensa).
 * (b) «Altro» su un pane con la nota «ho cambiato idea» nasceva senza nessun avviso per il forno:
 *     ora il reso nasce (la garanzia vale sempre) ma la nota dice che il prodotto è escluso.
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


describe('R04-001 onda 2 · il frigo scritto a mano conta come fresco', () => {
  for (const attributi of [
    { conservazione: 'In frigorifero' },
    { conservazione: 'Frigo' },
    { Conservazione: 'Frigorifero' },
    { ' CONSERVAZIONE ': 'frigorifero (0-4 °C)' },
  ]) {
    it(`${JSON.stringify(attributi)} sulla sola radice «Alimentari», senza spunta: ripensamento rifiutato`, async () => {
      ordineCon([{ id: 'mozza', name: 'Mozzarella di bufala', category_id: 'cat-alimentari', attributes: attributi }]);
      const res = await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }));
      expect(res.status, 'il fresco da frigo scritto a mano è passato come ripensamento').toBe(400);
      expect(await errore(res)).toMatch(/Mozzarella di bufala.*escluso dal recesso/);
      expect(db.tabelle.returns).toHaveLength(0);
    });
  }

  it('controprova: «in frigorifero dopo l\'apertura» è dispensa, il ripensamento passa', async () => {
    ordineCon([{ id: 'miele', name: 'Miele di acacia', category_id: 'cat-alimentari', attributes: { Conservazione: "Conservare in frigorifero dopo l'apertura" } }]);
    expect((await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }))).status).toBe(201);
  });

  it('controprova: «Freezer» e «Luogo fresco e asciutto» restano recedibili', async () => {
    ordineCon([{ id: 'gelato', name: 'Gelato', category_id: 'cat-alimentari', attributes: { Conservazione: 'Freezer' } }]);
    expect((await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }))).status).toBe(201);
    db.tabelle.returns = [];
    ordineCon([{ id: 'riso', name: 'Riso', category_id: 'cat-alimentari', attributes: { conservazione: 'Luogo fresco e asciutto' } }]);
    expect((await POST(richiesta({ orderId: ORDINE, reason: 'CHANGED_MIND' }))).status).toBe(201);
  });
});

describe('R04-001 onda 2 · «Altro» sul pane arriva al forno con l\'avviso', () => {
  it('«Altro» + «ho cambiato idea» su un pane: il reso nasce, e la nota dice che il recesso non è dovuto', async () => {
    ordineCon([{ id: 'pane', name: 'Pane casereccio', category_id: 'cat-panificio' }]);
    const res = await POST(richiesta({ orderId: ORDINE, reason: 'OTHER', notes: 'ho cambiato idea' }));
    expect(res.status).toBe(201);
    const note = String(db.tabelle.returns[0].notes ?? '');
    expect(note).toMatch(/^ho cambiato idea/);
    expect(note, 'il forno non sa che il pane è escluso dal recesso').toMatch(/escluso dal recesso/);
  });

  it('«Altro» su un ordine misto (pane + miele): la nota elenca il pane', async () => {
    ordineCon([
      { id: 'pane', name: 'Pane casereccio', category_id: 'cat-panificio' },
      { id: 'miele', name: 'Miele di acacia', category_id: 'cat-dispensa' },
    ]);
    expect((await POST(richiesta({ orderId: ORDINE, reason: 'OTHER' }))).status).toBe(201);
    expect(String(db.tabelle.returns[0].notes ?? '')).toMatch(/Esclusi dal recesso.*Pane casereccio/);
  });

  it('controprova: «Altro» su un prodotto recedibile resta senza nota; il difetto sul pane pure', async () => {
    ordineCon([{ id: 'miele', name: 'Miele di acacia', category_id: 'cat-dispensa' }]);
    expect((await POST(richiesta({ orderId: ORDINE, reason: 'OTHER' }))).status).toBe(201);
    expect(db.tabelle.returns[0].notes).toBeNull();
    db.tabelle.returns = [];
    ordineCon([{ id: 'pane', name: 'Pane casereccio', category_id: 'cat-panificio' }]);
    expect((await POST(richiesta({ orderId: ORDINE, reason: 'DAMAGED' }))).status).toBe(201);
    expect(db.tabelle.returns[0].notes).toBeNull();
  });
});
