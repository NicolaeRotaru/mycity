import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * 21/11/2026 (R03-008) — LA CHIUSURA DEL BENVENUTO TOCCA SOLO IL TENTATIVO IN CORSO.
 *
 * Il codice «solo primo ordine» si rivendica con `claim_coupon(p_code, p_user_id)` (migrazione 361):
 * ogni rivendicazione lascia una riga in `coupon_redemptions`, e finché una riga è aperta e recente
 * una seconda rivendicazione dello stesso cliente viene rifiutata. Quando la rotta dei contanti
 * restituisce il codice (tetto dei contanti, annullamento) chiudeva TUTTE le righe aperte del
 * cliente su quel codice: anche quella appena fatta da un'altra scheda, il cui ordine non è ancora
 * nato. Spento quel lucchetto, una terza scheda rivendica di nuovo e il benvenuto vale due volte.
 *
 * Il database finto fa quello che fa la 361 (lucchetto aperto e recente, oppure ordine vivo col
 * codice → no), con l'orologio finto.
 */

const FORNO = 'aaaaaaaa-0000-4000-8000-000000000001';
const PANE = '11111111-1111-4111-8111-111111111111';
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
  numeroRiga: 0,
  /** Quello che succede, nel frattempo, mentre la rotta restituisce il codice. */
  duranteIlRilascio: null as null | (() => void),
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
    { id: '33333333-3333-4333-8333-333333333333', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Forma intera', price: 2600, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: false },
  ];
  const colonne: Record<string, string[]> = {
    orders: ['id', 'user_id', 'payment_method', 'created_at'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    seller_public_profiles: ['id'],
    products: ['id'],
    coupons: ['id', 'code'],
    coupon_redemptions: ['id', 'coupon_id', 'user_id', 'released_at'],
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
    let ordine: { c: string; su: boolean } | null = null;
    let quante: number | null = null;
    const tieni = (c: string, f: (r: Riga) => boolean) => {
      if ((colonne[nome] ?? []).includes(c)) filtri.push(f);
    };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'gt', 'lt', 'lte', 'filter', 'not', 'or', 'upsert', 'neq']) b[m] = () => b;
    b.order = (c: string, o?: { ascending?: boolean }) => ((ordine = { c, su: o?.ascending !== false }), b);
    b.limit = (n: number) => ((quante = n), b);
    b.eq = (c: string, v: unknown) => (tieni(c, (r) => r[c] === v), b);
    b.is = (c: string, v: unknown) => (tieni(c, (r) => (r[c] ?? null) === v), b);
    b.in = (c: string, v: unknown[]) => (tieni(c, (r) => v.includes(r[c])), b);
    b.gte = (c: string, v: unknown) => (tieni(c, (r) => String(r[c]) >= String(v)), b);
    b.insert = (v: Riga | Riga[]) => ((op = 'insert'), (valori = Array.isArray(v) ? v[0] : v), b);
    b.update = (v: Riga) => ((op = 'update'), (valori = v), b);
    b.delete = () => ((op = 'delete'), b);
    const scelte = () => {
      let r = righeDi(nome).filter((x) => filtri.every((f) => f(x)));
      if (ordine) {
        const { c, su } = ordine;
        r = [...r].sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (su ? 1 : -1));
      }
      return quante === null ? r : r.slice(0, quante);
    };
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
        for (const r of righeDi(nome).filter((x) => filtri.every((f) => f(x)))) Object.assign(r, valori);
        return { data: null, error: null };
      }
      if (op === 'delete') {
        const via = new Set(righeDi(nome).filter((x) => filtri.every((f) => f(x))));
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
  /** claim_coupon(p_code, p_user_id) come lo scrive la migrazione 361. */
  const rivendica = (args: Riga) => {
    const codice = String(args.p_code ?? '').trim().toUpperCase();
    const buono = stato.buoni.find((c) => c.code === codice);
    if (!buono) return false;
    const chi = (args.p_user_id as string | undefined) ?? null;
    const adesso = Date.now();
    const lucchetto = stato.rivendicazioni.some(
      (r) => r.coupon_id === buono.id && r.user_id === chi && r.released_at == null && adesso - Date.parse(String(r.claimed_at)) < 2 * 60_000,
    );
    const ordineVivo = stato.ordini.some(
      (o) => o.user_id === chi && String(o.coupon_code ?? '').toUpperCase() === codice && o.delivery_status !== 'CANCELED',
    );
    if (buono.first_order_only && chi && (lucchetto || ordineVivo)) return false;
    buono.uses_count = Number(buono.uses_count) + 1;
    if (buono.first_order_only && chi) {
      stato.numeroRiga++;
      stato.rivendicazioni.push({ id: `riv-${stato.numeroRiga}`, coupon_id: buono.id, user_id: chi, claimed_at: new Date(adesso).toISOString(), released_at: null });
    }
    return true;
  };
  const rpc = (nome: string, args: Riga = {}) => {
    if (nome === 'claim_coupon') return Promise.resolve({ data: rivendica(args), error: null });
    if (nome === 'release_coupon') {
      const codice = String(args.p_code ?? '').trim().toUpperCase();
      const buono = stato.buoni.find((c) => c.code === codice);
      if (buono) buono.uses_count = Math.max(0, Number(buono.uses_count) - 1);
      stato.duranteIlRilascio?.();
      return Promise.resolve({ data: buono?.uses_count ?? 0, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  (stato as Record<string, unknown>).rivendicaDaUnAltraScheda = () => rivendica({ p_code: 'BENVENUTO5', p_user_id: 'cliente-1' });
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

const avanti = (secondi: number) => vi.setSystemTime(new Date(Date.now() + secondi * 1000));
const riga = (id: string) => stato.rivendicazioni.find((r) => r.id === id);

beforeEach(() => {
  // Giovedì 19/11/2026 alle 10 di Roma: la fascia di domani è ordinabile.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T09:00:00Z'));
  stato.ordini.length = 0;
  stato.tentativi.length = 0;
  stato.rivendicazioni.length = 0;
  stato.numeroRiga = 0;
  stato.duranteIlRilascio = null;
  stato.negozi.length = 0;
  stato.negozi.push({ id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null });
  stato.buoni.length = 0;
  stato.buoni.push({ id: 'buono-benvenuto', code: 'BENVENUTO5', first_order_only: true, uses_count: 0, max_uses: null, active: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-008 · la chiusura della rivendicazione del benvenuto tocca solo il tentativo in corso', () => {
  it('il tetto dei contanti chiude la riga di questo tentativo, non quella appena fatta da un altra scheda', async () => {
    // Il tentativo è lento: quando arriva a restituire il codice sono passati due minuti e mezzo, e
    // nel frattempo un'altra scheda dello stesso cliente ha rivendicato il benvenuto (riv-2).
    stato.duranteIlRilascio = () => {
      stato.duranteIlRilascio = null;
      avanti(150);
      const presa = (stato as unknown as { rivendicaDaUnAltraScheda: () => boolean }).rivendicaDaUnAltraScheda();
      expect(presa, 'la seconda scheda doveva poter rivendicare dopo due minuti').toBe(true);
    };
    const primo = await ordina('cod-tetto-lento', [SOPRA_IL_TETTO]);
    expect(primo.res.status, `il carrello da 5.200 € doveva fermarsi al tetto: ${JSON.stringify(primo.corpo)}`).toBe(409);
    expect(riga('riv-1')?.released_at, 'la rivendicazione di questo tentativo va chiusa').not.toBeNull();
    expect(riga('riv-2')?.released_at ?? null, 'la rivendicazione dell altra scheda è stata chiusa da questo tentativo').toBeNull();

    // Una terza scheda, subito dopo: il lucchetto dell'altra scheda è vivo, il benvenuto non si rivendica.
    avanti(5);
    const terzo = await ordina('cod-terza-scheda', [AL_FORNO]);
    expect(terzo.res.status, `il benvenuto è stato rivendicato due volte insieme: ${JSON.stringify(terzo.corpo)}`).toBe(400);
    expect(stato.ordini, 'nessun ordine col benvenuto doppio').toHaveLength(0);
  });

  it('senza altre schede, il benvenuto restituito al tetto si riusa subito (come prima)', async () => {
    const primo = await ordina('cod-tetto', [SOPRA_IL_TETTO]);
    expect(primo.res.status).toBe(409);
    expect(stato.rivendicazioni.filter((r) => r.user_id === CLIENTE && r.released_at == null)).toHaveLength(0);
    avanti(10);
    const secondo = await ordina('cod-dopo', [AL_FORNO]);
    expect(secondo.res.status, JSON.stringify(secondo.corpo)).toBe(200);
    expect(stato.ordini).toHaveLength(1);
  });
});
