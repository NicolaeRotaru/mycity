import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 29/10/2026 — IL CREDITO TOLTO DA UN TENTATIVO FALLITO TORNA, OGNI VOLTA.
 *
 * Il credito MyCity si scala dal totale dell'ordine in contanti (`wallet_debit`)
 * e, se l'ordine non nasce, si restituisce (`wallet_credit`). Il diario del
 * credito ha una chiave: la coppia motivo + riferimento (migrazione 143,
 * `wallet_ledger_chiave_idx`). Un secondo movimento con la stessa coppia non
 * tocca il saldo: e' quello che impedisce di accreditare due volte lo stesso
 * annullo.
 *
 * Il difetto: lo storno usava come riferimento l'identificativo dell'ordine. Da
 * quando quell'identificativo nasce dalla chiave del tentativo
 * (`idOrdiniDelTentativo`), due tentativi con la stessa chiave fanno ordini con
 * lo stesso id. Carrello forno + fioraio, fiori finiti: al primo tentativo il
 * credito del forno si toglie e si restituisce; la pagina si ricarica durante
 * l'invio, il browser riprova con la stessa chiave, il credito si toglie di
 * nuovo — e il diario scarta il secondo storno come doppione. Il cliente perde
 * il credito senza aver comprato niente.
 *
 * Qui il diario finto si comporta come quello vero: la coppia (motivo,
 * riferimento) non nulla e' unica, e un doppione non muove il saldo.
 */

const FORNO = 'aaaaaaaa-0000-4000-8000-000000000001';
const FIORAIO = 'bbbbbbbb-0000-4000-8000-000000000002';
const PANE = '11111111-1111-4111-8111-111111111111';
const FIORI = '22222222-2222-4222-8222-222222222222';
const PIACENZA = { lat: 45.0526, lng: 9.6929 };
const CREDITO_INIZIALE = 2000;

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  ordini: [] as Riga[],
  tentativi: [] as Riga[],
  negozi: [] as Riga[],
  diario: [] as Array<{ reason: string; ref: string | null; delta: number }>,
  saldo: 0,
  fioriFiniti: false,
  righeFalliscono: false,
}));

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
  const colonne: Record<string, string[]> = {
    orders: ['id', 'user_id', 'payment_method', 'created_at'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    seller_public_profiles: ['id'],
    products: ['id'],
  };
  const righeDi = (nome: string): Riga[] => {
    if (nome === 'orders') return stato.ordini;
    if (nome === 'cod_checkout_attempts') return stato.tentativi;
    if (nome === 'seller_public_profiles') return stato.negozi;
    if (nome === 'products') return prodotti;
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
          const id = (valori.id as string | undefined) ?? `ord-${stato.ordini.length + 1}`;
          if (stato.ordini.some((o) => o.id === id)) return { data: null, error: { code: '23505', message: 'duplicate key orders_pkey' } };
          stato.ordini.push({ ...valori, id, created_at: new Date().toISOString() });
          return { data: { id }, error: null };
        }
        if (nome === 'order_items' && stato.righeFalliscono) return { data: null, error: { message: 'righe non scritte' } };
        if (nome === 'cod_checkout_attempts') {
          if (stato.tentativi.some((t) => t.chiave === valori.chiave)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          stato.tentativi.push({ ...valori, created_at: new Date().toISOString() });
        }
        return { data: null, error: null };
      }
      if (op === 'update') {
        for (const r of scelte()) Object.assign(r, valori);
        return { data: null, error: null };
      }
      if (op === 'delete') {
        const via = new Set(scelte());
        const tutte = righeDi(nome);
        for (let i = tutte.length - 1; i >= 0; i--) if (via.has(tutte[i])) tutte.splice(i, 1);
        return { data: null, error: null };
      }
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

  /** Il diario del credito come la migrazione 143: (motivo, riferimento) non nullo e' unico. */
  const scrivi = (reason: string, ref: string | null, delta: number): boolean => {
    if (ref != null && stato.diario.some((r) => r.reason === reason && r.ref === ref)) return false; // ON CONFLICT DO NOTHING
    stato.diario.push({ reason, ref, delta });
    stato.saldo += delta;
    return true;
  };
  const rpc = (nome: string, a: Riga) => {
    if (nome === 'reserve_stock') {
      const voci = (a.p_items ?? []) as Array<{ product_id: string }>;
      if (stato.fioriFiniti && voci.some((v) => v.product_id === '22222222-2222-4222-8222-222222222222')) {
        return Promise.resolve({ data: null, error: { message: 'stock insufficiente' } });
      }
      return Promise.resolve({ data: null, error: null });
    }
    if (nome === 'wallet_debit') {
      const tolto = Math.min(stato.saldo, Number(a.p_max_cents));
      if (tolto <= 0) return Promise.resolve({ data: 0, error: null });
      const fatto = scrivi(String(a.p_reason), (a.p_ref as string | null) ?? null, -tolto);
      return Promise.resolve({ data: fatto ? tolto : 0, error: null });
    }
    if (nome === 'wallet_credit') {
      const cents = Number(a.p_cents);
      if (cents > 0) scrivi(String(a.p_reason), (a.p_ref as string | null) ?? null, cents);
      return Promise.resolve({ data: stato.saldo, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getAdminSupabase: () => ({
      from: tavola,
      rpc,
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from: tavola }),
  };
});

const AL_FORNO = { sellerId: FORNO, items: [{ productId: PANE, quantity: 1 }] };
const AL_FIORAIO = { sellerId: FIORAIO, items: [{ productId: FIORI, quantity: 1 }] };

async function ordina(chiave: string, gruppi: Array<typeof AL_FORNO>) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
    body: JSON.stringify({
      groups: gruppi,
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: true,
    }),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  return { res, corpo: (await res.json()) as Riga };
}

const toltoDalForno = () => stato.diario.filter((r) => r.reason === 'order_cod');

beforeEach(() => {
  stato.ordini.length = 0;
  stato.tentativi.length = 0;
  stato.diario.length = 0;
  stato.saldo = CREDITO_INIZIALE;
  stato.fioriFiniti = false;
  stato.righeFalliscono = false;
  stato.negozi.length = 0;
  stato.negozi.push(
    { id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
    { id: FIORAIO, store_name: 'Fiori di Via Roma', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
  );
});

describe('il credito tolto da un tentativo che non diventa ordine torna, anche al secondo tentativo con la stessa chiave', () => {
  it('forno + fioraio, fiori finiti, pagina ricaricata e stesso tocco due volte: il credito resta intero', async () => {
    stato.fioriFiniti = true;
    const chiave = 'cod-pagina-ricaricata';

    const primo = await ordina(chiave, [AL_FORNO, AL_FIORAIO]);
    expect(primo.res.status, JSON.stringify(primo.corpo)).toBe(409);
    expect(toltoDalForno().length, 'il credito doveva essere stato scalato dal forno').toBe(1);
    expect(stato.saldo, 'dopo il primo tentativo fallito il credito doveva tornare').toBe(CREDITO_INIZIALE);

    // La risposta non e' arrivata alla pagina: il browser riprova con la stessa chiave.
    const secondo = await ordina(chiave, [AL_FORNO, AL_FIORAIO]);
    expect(secondo.res.status, JSON.stringify(secondo.corpo)).toBe(409);
    expect(toltoDalForno().length, 'anche il secondo tentativo scala il credito del forno').toBe(2);
    expect(stato.saldo, 'il diario ha scartato il secondo storno: il cliente ha perso il credito').toBe(CREDITO_INIZIALE);
    expect(stato.ordini, 'nessun ordine doveva restare in piedi').toHaveLength(0);
  });

  it('righe dell ordine non scritte, due volte con la stessa chiave: il credito resta intero', async () => {
    stato.righeFalliscono = true;
    const chiave = 'cod-righe-perse';

    const primo = await ordina(chiave, [AL_FORNO]);
    expect(primo.res.status, JSON.stringify(primo.corpo)).toBe(500);
    expect(stato.saldo).toBe(CREDITO_INIZIALE);

    const secondo = await ordina(chiave, [AL_FORNO]);
    expect(secondo.res.status, JSON.stringify(secondo.corpo)).toBe(500);
    expect(toltoDalForno().length).toBe(2);
    expect(stato.saldo, 'il diario ha scartato il secondo storno: il cliente ha perso il credito').toBe(CREDITO_INIZIALE);
  });

  it("lo storno resta legato alla spesa che annulla: stesso riferimento, e uno solo per spesa", async () => {
    stato.fioriFiniti = true;
    await ordina('cod-legame', [AL_FORNO, AL_FIORAIO]);
    const spese = stato.diario.filter((r) => r.reason === 'order_cod');
    const storni = stato.diario.filter((r) => r.reason === 'order_cod_refund');
    expect(spese).toHaveLength(1);
    expect(storni).toHaveLength(1);
    expect(spese[0].ref, 'la spesa deve avere un riferimento, se no lo storno non ha a cosa legarsi').toBeTruthy();
    expect(storni[0].ref).toBe(spese[0].ref);
    expect(storni[0].delta).toBe(-spese[0].delta);
  });
});
