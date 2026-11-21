import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * 20/11/2026 (R04-007) — DOPO IL TETTO DEI CONTANTI O UN ANNULLAMENTO, IL BENVENUTO RESTAVA BLOCCATO.
 *
 * Il codice «solo primo ordine» si rivendica con `claim_coupon(p_code, p_user_id)` (migrazione 361):
 * la rivendicazione lascia una riga in `coupon_redemptions`, e finché quella riga è aperta e recente
 * una seconda rivendicazione dello stesso cliente viene rifiutata. La rotta dei contanti, quando
 * rifiutava l'ordine per il tetto della legge o lo annullava (merce finita al secondo negozio),
 * chiamava solo `release_coupon(p_code)`: il contatore tornava, la riga restava aperta, e il
 * tentativo subito dopo leggeva «Coupon non disponibile» senza nessun ordine nato.
 *
 * Il database finto fa quello che fa la 361 (lucchetto aperto e recente, oppure ordine vivo col
 * codice → no), con l'orologio finto: il secondo tentativo arriva 10 secondi dopo il primo.
 */

const FORNO = 'aaaaaaaa-0000-4000-8000-000000000001';
const FIORAIO = 'bbbbbbbb-0000-4000-8000-000000000002';
const PANE = '11111111-1111-4111-8111-111111111111';
const FIORI = '22222222-2222-4222-8222-222222222222';
const FORMA = '33333333-3333-4333-8333-333333333333';
const PIACENZA = { lat: 45.0526, lng: 9.6929 };
const CLIENTE = 'cliente-1';

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  ordini: [] as Riga[],
  tentativi: [] as Riga[],
  negozi: [] as Riga[],
  buoni: [] as Riga[],
  rivendicazioni: [] as Riga[],
  riservaFallisceAl: 0,
  riserve: 0,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  CODICI_SCONTO_IN_CASSA: true,
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
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
// La rilettura del codice (validateCoupon) passa: qui si misura la rivendicazione, cioè il lucchetto.
vi.mock('@/lib/coupons', () => ({
  validateCoupon: vi.fn(async () => ({ ok: true, discount: 5, freeShipping: false, coupon: { id: 'buono-benvenuto', code: 'BENVENUTO5' } })),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: vi.fn() }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => ({ lat: 45.0526, lng: 9.6929 })) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti: Riga[] = [
    { id: '11111111-1111-4111-8111-111111111111', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Pane', price: 40, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: false },
    { id: '22222222-2222-4222-8222-222222222222', seller_id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Fiori', price: 9, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: false },
    { id: '33333333-3333-4333-8333-333333333333', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Forma intera', price: 2600, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: false },
  ];
  const colonne: Record<string, string[]> = {
    orders: ['id', 'user_id', 'payment_method', 'created_at'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    seller_public_profiles: ['id'],
    products: ['id'],
    coupons: ['id', 'code'],
    coupon_redemptions: ['coupon_id', 'user_id', 'released_at'],
  };
  const righeDi = (nome: string): Riga[] => {
    if (nome === 'orders') return stato.ordini;
    if (nome === 'cod_checkout_attempts') return stato.tentativi;
    if (nome === 'seller_public_profiles') return stato.negozi;
    if (nome === 'products') return prodotti;
    if (nome === 'coupons') return stato.buoni;
    if (nome === 'coupon_redemptions') return stato.rivendicazioni;
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
    for (const m of ['select', 'order', 'limit', 'gt', 'lt', 'lte', 'filter', 'not', 'or', 'upsert', 'neq']) b[m] = () => b;
    b.eq = (c: string, v: unknown) => (tieni(c, (r) => r[c] === v), b);
    b.is = (c: string, v: unknown) => (tieni(c, (r) => (r[c] ?? null) === v), b);
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
  /** claim_coupon(p_code, p_user_id) e release_coupon(p_code) come li scrivono le migrazioni 116 e 361. */
  const rpc = (nome: string, args: Riga = {}) => {
    if (nome === 'reserve_stock') {
      stato.riserve++;
      if (stato.riservaFallisceAl === stato.riserve) return Promise.resolve({ data: null, error: { message: 'stock insufficiente' } });
    }
    if (nome === 'claim_coupon') {
      const codice = String(args.p_code ?? '').trim().toUpperCase();
      const buono = stato.buoni.find((c) => c.code === codice);
      if (!buono) return Promise.resolve({ data: false, error: null });
      const chi = (args.p_user_id as string | undefined) ?? null;
      const adesso = Date.now();
      const lucchetto = stato.rivendicazioni.some(
        (r) => r.coupon_id === buono.id && r.user_id === chi && r.released_at == null && adesso - Date.parse(String(r.claimed_at)) < 2 * 60_000,
      );
      const ordineVivo = stato.ordini.some(
        (o) => o.user_id === chi && String(o.coupon_code ?? '').toUpperCase() === codice && o.delivery_status !== 'CANCELED',
      );
      if (buono.first_order_only && chi && (lucchetto || ordineVivo)) return Promise.resolve({ data: false, error: null });
      buono.uses_count = Number(buono.uses_count) + 1;
      if (buono.first_order_only && chi) {
        stato.rivendicazioni.push({ coupon_id: buono.id, user_id: chi, claimed_at: new Date(adesso).toISOString(), released_at: null });
      }
      return Promise.resolve({ data: true, error: null });
    }
    if (nome === 'release_coupon') {
      const codice = String(args.p_code ?? '').trim().toUpperCase();
      const buono = stato.buoni.find((c) => c.code === codice);
      if (buono) buono.uses_count = Math.max(0, Number(buono.uses_count) - 1);
      return Promise.resolve({ data: buono?.uses_count ?? 0, error: null });
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
const SOPRA_IL_TETTO = { sellerId: FORNO, items: [{ productId: FORMA, quantity: 2 }] }; // 5.200 €

async function ordina(chiave: string, gruppi: unknown[]) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
    body: JSON.stringify({
      groups: gruppi,
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      couponCode: 'BENVENUTO5',
      pickupInStore: false,
      deliverySlot: FASCE_DI_DOMANI[0],
      useCredit: false,
    }),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  const corpo = (await res.json()) as Riga;
  return { res, corpo };
}

const rivendicazioniAperte = () => stato.rivendicazioni.filter((r) => r.user_id === CLIENTE && r.released_at == null);
const avanti = (secondi: number) => vi.setSystemTime(new Date(Date.now() + secondi * 1000));

beforeEach(() => {
  // Giovedì 19/11/2026 alle 10 di Roma: la fascia di domani è ordinabile.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T09:00:00Z'));
  stato.ordini.length = 0;
  stato.tentativi.length = 0;
  stato.rivendicazioni.length = 0;
  stato.negozi.length = 0;
  stato.negozi.push(
    { id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
    { id: FIORAIO, store_name: 'Fiori di Via Roma', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
  );
  stato.buoni.length = 0;
  stato.buoni.push({ id: 'buono-benvenuto', code: 'BENVENUTO5', first_order_only: true, uses_count: 0, max_uses: null, active: true });
  stato.riservaFallisceAl = 0;
  stato.riserve = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R04-007 · il benvenuto restituito dalla cassa in contanti si riusa subito', () => {
  it('sopra il tetto dei contanti: rifiutato, e 10 secondi dopo il benvenuto vale per un carrello giusto', async () => {
    const primo = await ordina('cod-tetto-1', [SOPRA_IL_TETTO]);
    expect(primo.res.status, `il carrello da 5.200 € doveva fermarsi al tetto: ${JSON.stringify(primo.corpo)}`).toBe(409);
    expect(stato.ordini, 'sopra il tetto non nasce nessun ordine').toHaveLength(0);
    expect(rivendicazioniAperte(), 'il benvenuto restituito tiene ancora acceso il lucchetto del cliente').toHaveLength(0);

    avanti(10);
    const secondo = await ordina('cod-tetto-2', [AL_FORNO]);
    expect(secondo.res.status, `il benvenuto resta bloccato dopo il tetto: ${JSON.stringify(secondo.corpo)}`).toBe(200);
    expect(stato.ordini, 'l ordine col benvenuto doveva nascere').toHaveLength(1);
    expect(stato.buoni[0].uses_count, 'il contatore deve dire un uso solo').toBe(1);
  });

  it('dopo l annullamento (merce finita al secondo negozio) il benvenuto vale subito al tentativo dopo', async () => {
    stato.riservaFallisceAl = 2;
    const primo = await ordina('cod-annullo-1', [AL_FORNO, AL_FIORAIO]);
    expect(primo.res.status, `il secondo negozio senza merce doveva annullare tutto: ${JSON.stringify(primo.corpo)}`).toBe(409);
    expect(stato.ordini, 'l ordine del forno doveva essere annullato').toHaveLength(0);
    expect(rivendicazioniAperte(), 'dopo l annullamento il lucchetto del benvenuto resta acceso').toHaveLength(0);

    stato.riservaFallisceAl = 0;
    avanti(10);
    const secondo = await ordina('cod-annullo-2', [AL_FORNO]);
    expect(secondo.res.status, `il benvenuto resta bloccato dopo l annullamento: ${JSON.stringify(secondo.corpo)}`).toBe(200);
    expect(stato.ordini).toHaveLength(1);
  });

  it('con l ordine nato il lucchetto resta: il benvenuto non si rivendica una seconda volta', async () => {
    const primo = await ordina('cod-buono-1', [AL_FORNO]);
    expect(primo.res.status, JSON.stringify(primo.corpo)).toBe(200);
    expect(rivendicazioniAperte(), 'con l ordine vivo la rivendicazione non va chiusa').toHaveLength(1);

    avanti(10);
    const secondo = await ordina('cod-buono-2', [AL_FORNO]);
    expect(secondo.res.status, 'il benvenuto è stato rivendicato due volte').toBe(400);
    expect(stato.ordini).toHaveLength(1);
  });
});
