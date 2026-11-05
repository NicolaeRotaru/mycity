import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/lib/logger';
import { idOrdiniDelTentativo } from '@/lib/ordini/chiave-dopo-l-errore';

/**
 * Sessione S02 (5/11/2026) — schede 2513, 2137, 2667, 2139: nei rami «serve una correzione a
 * mano» parte l'allarme agli amministratori, e un carrello da cui il cliente ha tolto un negozio
 * dopo un ordine arrivato per intero non si sente dire «ne è arrivata solo una parte».
 * Banco copiato da la-chiave-dei-contanti-ritrova-solo-i-suoi-ordini.test.ts.
 *
 * Originale: LA CASSA IN CONTANTI: UN ORDINE PER CARRELLO, NE' DUE NE' ZERO.
 *
 * Ogni tentativo d'ordine in contanti ha una chiave. Su quella chiave si regge la
 * promessa piu' importante della cassa: lo stesso carrello non diventa due ordini
 * (merce scalata due volte, credito tolto due volte, il negozio che prepara due
 * spese), e l'ordine di adesso non sparisce perche' la cassa lo confonde con un altro.
 *
 * Qui il database finto si comporta come quello vero dove conta: gli ordini hanno
 * una chiave primaria, i filtri (`eq`, `in`, `gte`) filtrano davvero, la riga della
 * chiave rifiuta il secondo inserimento. E il browser e' quello di
 * app/checkout/page.tsx ridotto all'osso: su errore butta la chiave se
 * `laChiaveVaButtata` dice si', sul successo svuota il carrello.
 */

const CLIENTE = 'cliente-1';
const FORNO = 'aaaaaaaa-0000-4000-8000-000000000001';
const FIORAIO = 'bbbbbbbb-0000-4000-8000-000000000002';
const PANE = '11111111-1111-4111-8111-111111111111';
const FIORI = '22222222-2222-4222-8222-222222222222';
const PIACENZA = { lat: 45.0526, lng: 9.6929 };

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  ordini: [] as Riga[],
  articoli: [] as Riga[],
  tentativi: [] as Riga[],
  profili: [] as Riga[],
  vetrina: null as null | { data: Riga[] | null; error: { message: string } | null },
  negozi: [] as Riga[],
  provaFallisce: false,
  rivendicaGuasta: false,
  letturaOrdiniFallisce: 0,
  insertFallisceSu: null as string | null,
  cancellazioniFalliscono: false,
  rpcFallisce: false,
}));
const notifyAdmins = vi.hoisted(() => vi.fn(async () => 'scritto'));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins }));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: Riga; profile: unknown; req: unknown }) => unknown) =>
    (req: unknown) =>
      h({
        user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn((orari: unknown) => orari !== 'chiuso'),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessun codice' })) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: vi.fn() }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => ({ lat: 45.0526, lng: 9.6929 })) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti: Riga[] = [
    { id: '11111111-1111-4111-8111-111111111111', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Pane', price: 4, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: false },
    { id: '22222222-2222-4222-8222-222222222222', seller_id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Fiori', price: 9, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: false },
  ];
  /** Le colonne su cui ogni tabella finta filtra davvero: le altre condizioni non toccano questi dati. */
  const colonne: Record<string, string[]> = {
    order_items: ['order_id'],
    orders: ['id', 'user_id', 'payment_method', 'created_at'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    profiles: ['id'],
    seller_public_profiles: ['id'],
    products: ['id'],
  };
  const righeDi = (nome: string): Riga[] => {
    if (nome === 'orders') return stato.ordini;
    if (nome === 'cod_checkout_attempts') return stato.tentativi;
    if (nome === 'profiles') return stato.profili;
    if (nome === 'seller_public_profiles') return stato.negozi;
    if (nome === 'products') return prodotti;
    if (nome === 'order_items') return stato.articoli;
    return [];
  };
  const tavola = (nome: string) => {
    const filtri: Array<(r: Riga) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let valori: Riga = {};
    const tieni = (c: string, f: (r: Riga) => boolean) => {
      if ((colonne[nome] ?? []).includes(c)) filtri.push(f);
    };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'is', 'gt', 'lt', 'lte', 'filter', 'not', 'or', 'upsert', 'neq']) b[m] = () => b;
    b.eq = (c: string, v: unknown) => (tieni(c, (r) => r[c] === v), b);
    b.in = (c: string, v: unknown[]) => (tieni(c, (r) => v.includes(r[c])), b);
    b.gte = (c: string, v: unknown) => (tieni(c, (r) => String(r[c]) >= String(v)), b);
    b.insert = (v: Riga | Riga[]) => ((op = 'insert'), (valori = Array.isArray(v) ? v[0] : v), b);
    b.update = (v: Riga) => ((op = 'update'), (valori = v), b);
    b.delete = () => ((op = 'delete'), b);
    const scelte = () => righeDi(nome).filter((r) => filtri.every((f) => f(r)));
    const esegui = (): { data: unknown; error: unknown } => {
      if (op === 'insert') {
        if (nome === 'orders') {
          if (stato.insertFallisceSu && valori.seller_id === stato.insertFallisceSu) {
            return { data: null, error: { code: '08006', message: 'connessione persa' } };
          }
          const id = (valori.id as string | undefined) ?? `ord-${stato.ordini.length + 1}`;
          if (stato.ordini.some((o) => o.id === id)) return { data: null, error: { code: '23505', message: 'duplicate key orders_pkey' } };
          stato.ordini.push({ ...valori, id, created_at: new Date().toISOString() });
          return { data: { id }, error: null };
        }
        if (nome === 'order_items') { stato.articoli.push({ ...valori }); return { data: null, error: null }; }
        if (nome === 'cod_checkout_attempts') {
          if (stato.rivendicaGuasta) return { data: null, error: { code: '08006', message: 'connessione persa' } };
          if (stato.tentativi.some((t) => t.chiave === valori.chiave)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          stato.tentativi.push({ ...valori, created_at: new Date().toISOString() });
        }
        return { data: null, error: null };
      }
      if (op === 'update') {
        if (nome === 'cod_checkout_attempts' && stato.provaFallisce) return { data: null, error: { message: 'rete caduta' } };
        for (const r of scelte()) Object.assign(r, valori);
        return { data: null, error: null };
      }
      if (op === 'delete') {
        if (stato.cancellazioniFalliscono) return { data: null, error: { message: 'timeout' } };
        const via = new Set(scelte());
        const tutte = righeDi(nome);
        for (let i = tutte.length - 1; i >= 0; i--) if (via.has(tutte[i])) tutte.splice(i, 1);
        return { data: null, error: null };
      }
      if (nome === 'orders' && stato.letturaOrdiniFallisce > 0) {
        stato.letturaOrdiniFallisce--;
        return { data: null, error: { message: 'timeout di rete' } };
      }
      if (nome === 'seller_public_profiles' && stato.vetrina) return stato.vetrina;
      return { data: scelte(), error: null };
    };
    const uno = () => {
      const e = esegui();
      return Array.isArray(e.data) ? { data: e.data[0] ?? null, error: e.error } : e;
    };
    b.single = () => Promise.resolve(uno());
    b.maybeSingle = () => Promise.resolve(uno());
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko);
    return b;
  };
  return {
    getAdminSupabase: () => ({
      from: tavola,
      rpc: (nome: string) => Promise.resolve({ data: null, error: stato.rpcFallisce && nome === 'restore_stock' ? { message: 'giù' } : null }),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from: tavola }),
  };
});

const AL_FORNO = { sellerId: FORNO, items: [{ productId: PANE, quantity: 1 }] };
const AL_FIORAIO = { sellerId: FIORAIO, items: [{ productId: FIORI, quantity: 1 }] };

async function ordina(chiave: string | null, gruppi = [AL_FORNO]) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(chiave ? { 'idempotency-key': chiave } : {}) },
    body: JSON.stringify({
      groups: gruppi,
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  const corpo = (await res.json()) as Riga & { data?: { orderIds?: string[] }; orderIds?: string[] };
  return { res, corpo, ids: corpo.data?.orderIds ?? corpo.orderIds ?? [] };
}

const alForno = () => stato.ordini.filter((o) => o.seller_id === FORNO);

beforeEach(() => {
  stato.ordini.length = 0;
  stato.articoli.length = 0;
  stato.tentativi.length = 0;
  stato.profili.length = 0;
  stato.negozi.length = 0;
  stato.negozi.push(
    { id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
    { id: FIORAIO, store_name: 'Fiori di Via Roma', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
  );
  stato.vetrina = null;
  stato.provaFallisce = false;
  stato.rivendicaGuasta = false;
  stato.letturaOrdiniFallisce = 0;
  stato.insertFallisceSu = null;
  stato.cancellazioniFalliscono = false;
  stato.rpcFallisce = false;
  notifyAdmins.mockClear();
  vi.mocked(logger.error).mockClear();
});


const errori = () => vi.mocked(logger.error).mock.calls.map((c) => String(c[0]));

describe('i rami «serve una correzione a mano» avvisano gli amministratori', () => {
  it('2513 · ordine della chiave senza articoli: 409 «ti aiutiamo noi» E campanella agli amministratori', async () => {
    const chiave = 'cod-senza-articoli';
    stato.tentativi.push({ chiave, user_id: CLIENTE, order_ids: [], created_at: new Date(Date.now() - 120_000).toISOString() });
    const [id] = await idOrdiniDelTentativo(chiave, CLIENTE, 1);
    stato.ordini.push({ id, user_id: CLIENTE, seller_id: FORNO, total_price: 7.5, payment_method: 'cod', created_at: new Date().toISOString() });
    const { res } = await ordina(chiave);
    expect(res.status).toBe(409);
    expect(notifyAdmins).toHaveBeenCalledWith('Ordine in contanti fermo a metà', expect.stringContaining('7,50'), '/admin/orders');
  });

  it('2137 · ordine nato solo in parte: anche qui parte la campanella agli amministratori', async () => {
    const chiave = 'cod-in-parte';
    stato.tentativi.push({ chiave, user_id: CLIENTE, order_ids: [], created_at: new Date(Date.now() - 120_000).toISOString() });
    const [id] = await idOrdiniDelTentativo(chiave, CLIENTE, 1);
    stato.ordini.push({ id, user_id: CLIENTE, seller_id: FORNO, total_price: 7.5, payment_method: 'cod', created_at: new Date().toISOString() });
    const { res } = await ordina(chiave, [AL_FORNO, AL_FIORAIO]);
    expect(res.status).toBe(409);
    expect(notifyAdmins).toHaveBeenCalledWith('Ordine in contanti nato solo in parte', expect.any(String), '/admin/orders');
  });

  it('2137 · il cliente ha tolto il fioraio dopo un ordine arrivato per intero: «fatto» con i due ordini, non «una parte»', async () => {
    const chiave = 'cod-tolto-un-negozio';
    stato.tentativi.push({ chiave, user_id: CLIENTE, order_ids: [], created_at: new Date(Date.now() - 120_000).toISOString() });
    const ids = await idOrdiniDelTentativo(chiave, CLIENTE, 10);
    stato.ordini.push(
      { id: ids[0], user_id: CLIENTE, seller_id: FORNO, total_price: 7.5, payment_method: 'cod', created_at: new Date().toISOString() },
      { id: ids[1], user_id: CLIENTE, seller_id: FIORAIO, total_price: 12, payment_method: 'cod', created_at: new Date().toISOString() },
    );
    stato.articoli.push({ order_id: ids[0] }, { order_id: ids[1] });
    const { res, corpo, ids: restituiti } = await ordina(chiave, [AL_FORNO]);
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(restituiti.sort()).toEqual([ids[0], ids[1]].sort());
    expect(errori().some((e) => e.includes('solo in parte'))).toBe(false);
    expect(alForno(), 'non deve nascere un secondo ordine al forno').toHaveLength(1);
  });

  it('2133 · stessi NUMERI di negozi ma negozi diversi (forno + un terzo, carrello forno + fioraio): resta «una parte»', async () => {
    const chiave = 'cod-numero-uguale';
    stato.tentativi.push({ chiave, user_id: CLIENTE, order_ids: [], created_at: new Date(Date.now() - 120_000).toISOString() });
    const ids = await idOrdiniDelTentativo(chiave, CLIENTE, 10);
    stato.ordini.push(
      { id: ids[0], user_id: CLIENTE, seller_id: FORNO, total_price: 7.5, payment_method: 'cod', created_at: new Date().toISOString() },
      { id: ids[1], user_id: CLIENTE, seller_id: 'cccccccc-0000-4000-8000-000000000003', total_price: 5, payment_method: 'cod', created_at: new Date().toISOString() },
    );
    stato.articoli.push({ order_id: ids[0] }, { order_id: ids[1] });
    const { res } = await ordina(chiave, [AL_FORNO, AL_FIORAIO]);
    expect(res.status).toBe(409);
    expect(errori().some((e) => e.includes('solo in parte'))).toBe(true);
  });

  it('2667/2139 · l annullamento dopo un errore non riesce: oltre alla riga nel registro parte l allarme', async () => {
    stato.insertFallisceSu = FIORAIO;
    stato.cancellazioniFalliscono = true;
    const { res } = await ordina(null, [AL_FORNO, AL_FIORAIO]);
    expect(res.ok).toBe(false);
    expect(errori().some((e) => e.includes('annullamento non riuscito'))).toBe(true);
    expect(notifyAdmins).toHaveBeenCalledWith('Ordine in contanti rimasto in piedi dopo un errore', expect.any(String), '/admin/orders');
  });

  it('2139 · se la merce o il credito dell ordine non nato non tornano, resta una riga nel registro', async () => {
    stato.insertFallisceSu = FORNO;
    stato.rpcFallisce = true;
    const { res } = await ordina(null, [AL_FORNO]);
    expect(res.ok).toBe(false);
    expect(errori().some((e) => e.includes('la merce non e tornata'))).toBe(true);
  });
});
