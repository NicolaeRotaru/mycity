import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * 28/11/2026 (R08-007, onda 2) — LA PULIZIA DELLE CASSE ABBANDONATE CHIUDEVA LA RIVENDICAZIONE ANCHE SE
 * IL CODICE NON ERA TORNATO.
 *
 * Maria preme «Paga con carta» col benvenuto «solo primo ordine»: il codice si rivendica (`claim_coupon`,
 * migrazione 361, una riga in `coupon_redemptions`) e l'uso si conta. La carta viene rifiutata; Maria
 * torna e ripreme «Paga» (o sceglie i contanti). La pulizia chiude la pagina vecchia e prova a restituire
 * il codice (`release_coupon`): se quella chiamata cade, l'uso resta contato. Le due rotte chiudevano lo
 * stesso la rivendicazione della cassa liberata, e la rivendicazione nuova passava: un secondo uso contato
 * sopra quello mai restituito. L'avviso di Stripe (lib/stripe/webhook/carrello-scaduto.ts) e
 * `rilasciaCoupon` della cassa la lasciano aperta quando il codice non torna; adesso anche la pulizia
 * (`codiceNonTornato` di `liberaRiserveAbbandonate`).
 *
 * Le rotte sono quelle vere, sullo stesso database finto della prova R01-006; la pulizia è quella vera.
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
  /** `release_coupon` cade: il codice non torna. */
  restituzioneCade: false,
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
      if (db.restituzioneCade) return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } });
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

async function pagaConLaCarta(fascia: string = FASCE_DI_DOMANI[0]) {
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
  db.restituzioneCade = false;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('R08-007 · se il codice non torna, la rivendicazione della cassa liberata resta aperta', () => {
  it('carta rifiutata, poi «pago alla consegna» col codice che non torna: niente secondo uso sopra quello non restituito', async () => {
    const carta = await pagaConLaCarta();
    expect(carta.stato, JSON.stringify(carta.corpo)).toBe(200);
    expect(db.buoni[0].uses_count).toBe(1);

    db.restituzioneCade = true;
    avanti(30);
    await pagoAllaConsegna('cod-codice-non-tornato');
    expect(db.chiuse, 'la pagina di pagamento con la carta doveva chiudersi').toEqual(['cs_1']);
    expect(db.intenti[0].status, 'la merce della cassa con la carta torna comunque').toBe('EXPIRED');
    expect(
      db.rivendicazioni.find((r) => r.id === 'riv-1')?.released_at ?? null,
      'chiusa la rivendicazione di una cassa il cui codice non è tornato',
    ).toBeNull();
    expect(db.buoni[0].uses_count, 'contato un secondo uso sopra quello mai restituito').toBe(1);
  });

  it('carta rifiutata, poi di nuovo «Paga» col codice che non torna: la rivendicazione vecchia resta aperta', async () => {
    const primo = await pagaConLaCarta();
    expect(primo.stato, JSON.stringify(primo.corpo)).toBe(200);

    db.restituzioneCade = true;
    avanti(30);
    // Un'altra fascia: lo stesso carrello identico riuserebbe la cassa aperta invece di liberarla.
    await pagaConLaCarta(FASCE_DI_DOMANI[1]);
    expect(db.chiuse, 'la pagina di pagamento vecchia doveva chiudersi').toEqual(['cs_1']);
    expect(
      db.rivendicazioni.find((r) => r.id === 'riv-1')?.released_at ?? null,
      'chiusa la rivendicazione di una cassa il cui codice non è tornato',
    ).toBeNull();
    expect(db.buoni[0].uses_count, 'contato un secondo uso sopra quello mai restituito').toBe(1);
  });

  it('col codice tornato si chiude come prima (R01-006)', async () => {
    const carta = await pagaConLaCarta();
    expect(carta.stato, JSON.stringify(carta.corpo)).toBe(200);
    avanti(30);
    const contanti = await pagoAllaConsegna('cod-codice-tornato');
    expect(contanti.stato, JSON.stringify(contanti.corpo)).toBe(200);
    expect(db.rivendicazioni.find((r) => r.id === 'riv-1')?.released_at ?? null).not.toBeNull();
    expect(db.rivendicazioni.filter((r) => r.user_id === CLIENTE && r.released_at == null).map((r) => r.id)).toEqual(['riv-2']);
  });
});
