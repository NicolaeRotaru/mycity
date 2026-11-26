import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';
import { liberaRiserveAbbandonate } from '@/lib/ordini/riserve-abbandonate';

/**
 * R25-003 (26/11/2026) — LA PULIZIA CHIUDEVA LA RIVENDICAZIONE ANCHE SE IL CODICE NON ERA TORNATO.
 *
 * Maria preme «Paga con carta» col benvenuto: il codice si rivendica (una riga in
 * `coupon_redemptions`) e si apre la pagina di Stripe. Torna indietro e riprova (contanti, o la
 * carta con un'altra fascia). La pulizia (`liberaRiserveAbbandonate`) chiude la pagina vecchia,
 * rimette la merce e chiama `release_coupon`: se quella chiamata cade, il tentativo finiva lo stesso
 * fra i «liberati», e la cassa chiudeva la sua rivendicazione mentre il contatore del codice restava
 * a «usato». L'avviso di Stripe e `rilasciaCoupon` della cassa, nello stesso caso, la lasciano aperta.
 *
 * Il banco di prova è quello della prova R01-006 (le due rotte vere, la pulizia vera, un database
 * finto che fa quello che fa la migrazione 361), con `release_coupon` che può fallire.
 */

const NEGOZIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const PRODOTTO = '11111111-1111-4111-8111-111111111111';
const CLIENTE = 'maria';

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  buoni: [] as Array<Record<string, unknown>>,
  rivendicazioni: [] as Array<Record<string, unknown>>,
  intenti: [] as Array<Record<string, unknown>>,
  ordini: [] as Array<Record<string, unknown>>,
  tentativi: [] as Array<Record<string, unknown>>,
  numero: 0,
  sessioni: 0,
  chiuse: [] as string[],
  releaseRotto: false,
}));

vi.mock('@/lib/auth/accettazione-testi', async (o) => ({ ...((await o()) as object), vaChiestaSenzaTrattenere: async () => 'lascia-entrare' }));
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  CARTA_ACCESA: true,
  CODICI_SCONTO_IN_CASSA: true,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: Riga; profile: unknown; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: { id: 'maria', email: 'maria@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' }, profile: { role: 'buyer', is_approved: true }, req }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/stripe/client', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: vi.fn(async () => {
    db.sessioni++;
    return { id: `cs_${db.sessioni}`, url: `https://stripe.test/cs_${db.sessioni}` };
  }),
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, status: 'open', url: `https://stripe.test/${id}` }),
        expire: async (id: string) => (db.chiuse.push(id), { id, status: 'expired' }),
      },
    },
  }),
}));
// La rilettura del codice passa: qui si misura la rivendicazione, cioè il lucchetto.
vi.mock('@/lib/coupons', () => ({
  validateCoupon: vi.fn(async () => ({ ok: true, discount: 5, freeShipping: false, coupon: { id: 'buono-benvenuto', code: 'BENVENUTO5' } })),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => ({ lat: 45.0526, lng: 9.6929 })) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', async (o) => ({
  ...((await o()) as Record<string, unknown>),
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: vi.fn() }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti: Riga[] = [
    { id: '11111111-1111-4111-8111-111111111111', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Pane', price: 40, stock: 10, has_variants: false, images: [], status: 'available', express_enabled: false },
  ];
  const venditori: Riga[] = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', store_name: 'Pane Quotidiano', store_lat: 45.0526, store_lng: 9.6929, store_hours: null }];
  const righeDi = (nome: string): Riga[] => {
    if (nome === 'products') return prodotti;
    if (nome === 'seller_public_profiles') return venditori;
    if (nome === 'coupons') return db.buoni;
    if (nome === 'coupon_redemptions') return db.rivendicazioni;
    if (nome === 'pending_checkouts') return db.intenti;
    if (nome === 'orders') return db.ordini;
    if (nome === 'cod_checkout_attempts') return db.tentativi;
    return [];
  };
  const filtrabili: Record<string, string[]> = {
    coupons: ['id', 'code'],
    coupon_redemptions: ['id', 'coupon_id', 'user_id', 'released_at'],
    pending_checkouts: ['id', 'buyer_id', 'status'],
    orders: ['id', 'user_id', 'payment_method', 'stripe_session_id'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    products: ['id'],
    seller_public_profiles: ['id'],
  };
  const tavola = (nome: string) => {
    const filtri: Array<(r: Riga) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let valori: Riga = {};
    let ordine: { c: string; su: boolean } | null = null;
    let quante: number | null = null;
    const tieni = (c: string, f: (r: Riga) => boolean) => {
      if ((filtrabili[nome] ?? []).includes(c)) filtri.push(f);
    };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'gt', 'lt', 'lte', 'gte', 'not', 'or', 'neq', 'upsert']) b[m] = () => b;
    b.in = (c: string, v: unknown[]) => (tieni(c, (r) => v.includes(r[c])), b);
    b.order = (c: string, o?: { ascending?: boolean }) => ((ordine = { c, su: o?.ascending !== false }), b);
    b.limit = (n: number) => ((quante = n), b);
    b.eq = (c: string, v: unknown) => (tieni(c, (r) => r[c] === v), b);
    b.is = (c: string, v: unknown) => (tieni(c, (r) => (r[c] ?? null) === v), b);
    // Il riuso della cassa aperta cerca lo STESSO carrello (impronta uguale).
    b.filter = (c: string, _op: string, v: unknown) => {
      if (c === 'delivery->>impronta_carrello') filtri.push((r) => (r.delivery as Riga | undefined)?.impronta_carrello === v);
      return b;
    };
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
        if (nome === 'pending_checkouts') {
          const riga = { ...valori, id: `pc_${db.intenti.length + 1}`, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(), stripe_session_id: null };
          db.intenti.push(riga);
          return { data: [riga], error: null };
        }
        if (nome === 'orders') {
          const id = (valori.id as string | undefined) ?? `ord-${db.ordini.length + 1}`;
          if (db.ordini.some((o) => o.id === id)) return { data: null, error: { code: '23505', message: 'duplicate key orders_pkey' } };
          db.ordini.push({ ...valori, id, created_at: new Date().toISOString() });
          return { data: { id }, error: null };
        }
        if (nome === 'cod_checkout_attempts') {
          if (db.tentativi.some((t) => t.chiave === valori.chiave)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          db.tentativi.push({ ...valori, created_at: new Date().toISOString() });
        }
        return { data: null, error: null };
      }
      if (op === 'update') {
        const toccate = righeDi(nome).filter((x) => filtri.every((f) => f(x)));
        for (const r of toccate) Object.assign(r, valori);
        return { data: toccate.map((r) => ({ id: r.id })), error: null };
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
  /** claim_coupon(p_code, p_user_id) e release_coupon(p_code) come li scrivono le migrazioni 116 e 361. */
  const rpc = (nome: string, args: Riga = {}) => {
    if (nome === 'claim_coupon') {
      const codice = String(args.p_code ?? '').trim().toUpperCase();
      const buono = db.buoni.find((c) => c.code === codice);
      if (!buono) return Promise.resolve({ data: false, error: null });
      const chi = (args.p_user_id as string | undefined) ?? null;
      const adesso = Date.now();
      const lucchetto = db.rivendicazioni.some(
        (r) => r.coupon_id === buono.id && r.user_id === chi && r.released_at == null && adesso - Date.parse(String(r.claimed_at)) < 2 * 60_000,
      );
      const cassaAperta = db.intenti.some(
        (p) => p.buyer_id === chi && String(p.coupon_code ?? '').toUpperCase() === codice && p.status === 'PENDING' && Date.parse(String(p.expires_at)) > adesso,
      );
      const ordineVivo = db.ordini.some(
        (o) => o.user_id === chi && String(o.coupon_code ?? '').toUpperCase() === codice && o.delivery_status !== 'CANCELED',
      );
      if (buono.first_order_only && chi && (lucchetto || cassaAperta || ordineVivo)) return Promise.resolve({ data: false, error: null });
      buono.uses_count = Number(buono.uses_count) + 1;
      if (buono.first_order_only && chi) {
        db.numero++;
        db.rivendicazioni.push({ id: `riv-${db.numero}`, coupon_id: buono.id, user_id: chi, claimed_at: new Date(adesso).toISOString(), released_at: null });
      }
      return Promise.resolve({ data: true, error: null });
    }
    if (nome === 'release_coupon') {
      // R25-003 — la restituzione del codice può cadere (database lento, rete): niente cambia.
      if (db.releaseRotto) return Promise.resolve({ data: null, error: { message: 'release_coupon: timeout' } });
      const buono = db.buoni.find((c) => c.code === String(args.p_code ?? '').trim().toUpperCase());
      if (buono) buono.uses_count = Math.max(0, Number(buono.uses_count) - 1);
      return Promise.resolve({ data: buono?.uses_count ?? 0, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  const client = {
    from: tavola,
    rpc,
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
  };
  return {
    getServerSupabase: async () => client,
    getAdminSupabase: () => client,
  };
});

const CONSEGNA = { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' };
const GRUPPI = [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }], shippingCents: 0 }];

async function pagaConLaCarta(fascia = FASCE_DI_DOMANI[0]) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(
    new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups: GRUPPI, delivery: CONSEGNA, couponCode: 'BENVENUTO5', pickupInStore: false, deliverySlot: fascia }),
    }) as never,
  );
  return { stato: res.status, corpo: (await res.json()) as Riga };
}

async function pagoAllaConsegna(chiave: string) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(
    new Request('http://localhost/api/orders/cod', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
      body: JSON.stringify({ groups: GRUPPI, delivery: CONSEGNA, couponCode: 'BENVENUTO5', pickupInStore: false, deliverySlot: FASCE_DI_DOMANI[0], useCredit: false }),
    }) as never,
  );
  return { stato: res.status, corpo: (await res.json()) as Riga };
}

const avanti = (secondi: number) => vi.setSystemTime(new Date(Date.now() + secondi * 1000));
const aperte = () => db.rivendicazioni.filter((r) => r.user_id === CLIENTE && r.released_at == null);

beforeEach(() => {
  // Giovedì 19/11/2026 alle 10 di Roma: la fascia di domani è ordinabile.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T09:00:00Z'));
  db.buoni.length = 0;
  db.buoni.push({ id: 'buono-benvenuto', code: 'BENVENUTO5', first_order_only: true, uses_count: 0, max_uses: null, active: true });
  db.rivendicazioni.length = 0;
  db.intenti.length = 0;
  db.ordini.length = 0;
  db.tentativi.length = 0;
  db.numero = 0;
  db.sessioni = 0;
  db.chiuse.length = 0;
  db.releaseRotto = false;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('R25-003 · la pulizia, da sola', () => {
  const riga = {
    id: 'pc_vecchio',
    created_at: '2026-11-19T08:00:00Z',
    groups: [{ items: [{ productId: PRODOTTO, quantity: 1, variantId: null }] }],
    coupon_code: 'BENVENUTO5',
    stripe_session_id: 'cs_vecchio',
    delivery: { impronta_carrello: 'un-altro-carrello', rivendicazione: 'riv-1' },
  };
  const client = (erroreCodice: { message: string } | null) => {
    const rpc: string[] = [];
    const scritte: unknown[] = [];
    const catena = (valore: unknown) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit']) q[m] = () => q;
      q.update = (v: unknown) => (scritte.push(v), catena({ data: [{ id: riga.id }], error: null }));
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(valore).then(ok);
      return q;
    };
    return {
      rpc,
      scritte,
      c: {
        from: (t: string) => catena(t === 'pending_checkouts' ? { data: [riga], error: null } : { data: [], error: null }),
        rpc: (n: string) => (rpc.push(n), Promise.resolve({ data: null, error: n === 'release_coupon' ? erroreCodice : null })),
      },
    };
  };
  const pulisci = (db: ReturnType<typeof client>) =>
    liberaRiserveAbbandonate(db.c as never, { buyerId: CLIENTE, soloConProdotti: [PRODOTTO], chiudiSessione: async () => 'chiusa' });

  it('codice tornato: il tentativo è fra i liberati', async () => {
    const db = client(null);
    expect((await pulisci(db)).liberati).toEqual(['pc_vecchio']);
  });

  it('codice NON tornato: la merce torna, ma il tentativo non è fra i liberati', async () => {
    const db = client({ message: 'timeout' });
    const esito = await pulisci(db);
    expect(db.scritte).toEqual([{ status: 'EXPIRED' }]);
    expect(db.rpc).toEqual(['restore_stock', 'release_coupon']);
    expect(esito.liberati).toEqual([]);
    expect(esito.ancoraPagabili).toEqual([]);
  });
});

describe('R25-003 · le due casse non chiudono la rivendicazione se il codice non è tornato', () => {
  it('contanti dopo la carta, con release_coupon che cade: la rivendicazione della carta resta aperta', async () => {
    const carta = await pagaConLaCarta();
    expect(carta.stato, JSON.stringify(carta.corpo)).toBe(200);
    expect(aperte().map((r) => r.id)).toEqual(['riv-1']);

    avanti(30);
    db.releaseRotto = true;
    await pagoAllaConsegna('cod-codice-non-tornato');
    expect(db.chiuse, 'la pagina con la carta doveva chiudersi lo stesso').toEqual(['cs_1']);
    expect(db.intenti[0].status, 'la merce della carta doveva tornare a scaffale lo stesso').toBe('EXPIRED');
    expect(db.buoni[0].uses_count, 'il codice non è tornato: il contatore dice ancora «usato»').toBe(1);
    expect(
      db.rivendicazioni.find((r) => r.id === 'riv-1')?.released_at ?? null,
      'chiusa la rivendicazione di un codice che non è tornato',
    ).toBeNull();
  });

  it('di nuovo la carta con un’altra fascia, con release_coupon che cade: la rivendicazione resta aperta', async () => {
    const prima = await pagaConLaCarta(FASCE_DI_DOMANI[0]);
    expect(prima.stato, JSON.stringify(prima.corpo)).toBe(200);

    avanti(30);
    db.releaseRotto = true;
    await pagaConLaCarta(FASCE_DI_DOMANI[1]);
    expect(db.chiuse).toEqual(['cs_1']);
    expect(db.intenti[0].status).toBe('EXPIRED');
    expect(
      db.rivendicazioni.find((r) => r.id === 'riv-1')?.released_at ?? null,
      'chiusa la rivendicazione di un codice che non è tornato',
    ).toBeNull();
  });

  it('col codice tornato la rivendicazione si chiude, come prima', async () => {
    const carta = await pagaConLaCarta();
    expect(carta.stato, JSON.stringify(carta.corpo)).toBe(200);
    avanti(30);
    const contanti = await pagoAllaConsegna('cod-codice-tornato');
    expect(contanti.stato, JSON.stringify(contanti.corpo)).toBe(200);
    expect(db.rivendicazioni.find((r) => r.id === 'riv-1')?.released_at ?? null).not.toBeNull();
  });
});
