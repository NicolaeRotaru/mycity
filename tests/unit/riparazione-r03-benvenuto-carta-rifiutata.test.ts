import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * 21/11/2026 (R03-011) — IL BENVENUTO RESTITUITO DOPO UN RIFIUTO DELLA CARTA RESTAVA BLOCCATO AL
 * TENTATIVO DOPO.
 *
 * Maria preme «Paga con carta» col benvenuto «solo primo ordine»: il codice si rivendica
 * (`claim_coupon(p_code, p_user_id)`, migrazione 361, una riga in `coupon_redemptions`) e si apre la
 * pagina di Stripe. La carta viene rifiutata; Maria torna indietro, sposta la consegna e ripreme
 * «Paga». La pulizia dei tentativi abbandonati chiude la pagina vecchia e restituisce il codice
 * (`release_coupon(p_code)`), ma la rivendicazione di quel tentativo restava aperta: entro due
 * minuti la cassa nuova rispondeva «Coupon non disponibile».
 *
 * Il database finto fa quello che fa la 361 (lucchetto aperto e recente, oppure cassa con la carta
 * ancora aperta col codice → no). La pulizia è quella vera (`liberaRiserveAbbandonate`).
 */

const NEGOZIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const PRODOTTO = '11111111-1111-4111-8111-111111111111';
const CLIENTE = 'maria';

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  buoni: [] as Array<Record<string, unknown>>,
  rivendicazioni: [] as Array<Record<string, unknown>>,
  intenti: [] as Array<Record<string, unknown>>,
  numero: 0,
  sessioni: 0,
  stripeCade: 0,
  chiuse: [] as string[],
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
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  RiservaTroppoCorta: class RiservaTroppoCorta extends Error {},
  createMultiSellerCheckoutSession: vi.fn(async () => {
    if (db.stripeCade > 0) {
      db.stripeCade--;
      throw new Error('Stripe non risponde');
    }
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
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
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
    { id: '11111111-1111-4111-8111-111111111111', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Torta', price: 20, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori: Riga[] = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: null }];
  const righeDi = (nome: string): Riga[] => {
    if (nome === 'products') return prodotti;
    if (nome === 'seller_public_profiles') return venditori;
    if (nome === 'coupons') return db.buoni;
    if (nome === 'coupon_redemptions') return db.rivendicazioni;
    if (nome === 'pending_checkouts') return db.intenti;
    return [];
  };
  const filtrabili: Record<string, string[]> = {
    coupons: ['id', 'code'],
    coupon_redemptions: ['id', 'coupon_id', 'user_id', 'released_at'],
    pending_checkouts: ['id', 'buyer_id', 'status'],
    products: ['id'],
    seller_public_profiles: ['id'],
  };
  const tavola = (nome: string) => {
    const filtri: Array<(r: Riga) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let valori: Riga = {};
    let ordine: { c: string; su: boolean } | null = null;
    let quante: number | null = null;
    const tieni = (c: string, f: (r: Riga) => boolean) => {
      if ((filtrabili[nome] ?? []).includes(c)) filtri.push(f);
    };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'gt', 'lt', 'lte', 'gte', 'not', 'or', 'neq']) b[m] = () => b;
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
    b.insert = (v: Riga) => ((op = 'insert'), (valori = v), b);
    b.update = (v: Riga) => ((op = 'update'), (valori = v), b);
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
        return { data: null, error: null };
      }
      if (op === 'update') {
        const toccate = righeDi(nome).filter((x) => filtri.every((f) => f(x)));
        for (const r of toccate) Object.assign(r, valori);
        return { data: toccate.map((r) => ({ id: r.id })), error: null };
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
      if (buono.first_order_only && chi && (lucchetto || cassaAperta)) return Promise.resolve({ data: false, error: null });
      buono.uses_count = Number(buono.uses_count) + 1;
      if (buono.first_order_only && chi) {
        db.numero++;
        db.rivendicazioni.push({ id: `riv-${db.numero}`, coupon_id: buono.id, user_id: chi, claimed_at: new Date(adesso).toISOString(), released_at: null });
      }
      return Promise.resolve({ data: true, error: null });
    }
    if (nome === 'release_coupon') {
      const buono = db.buoni.find((c) => c.code === String(args.p_code ?? '').trim().toUpperCase());
      if (buono) buono.uses_count = Math.max(0, Number(buono.uses_count) - 1);
      return Promise.resolve({ data: buono?.uses_count ?? 0, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return {
    getServerSupabase: async () => ({ from: tavola, rpc }),
    getAdminSupabase: () => ({ from: tavola, rpc }),
  };
});

async function paga(fascia: string) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(
    new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }], shippingCents: 0 }],
        delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
        couponCode: 'BENVENUTO5',
        pickupInStore: false,
        deliverySlot: fascia,
      }),
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
  db.numero = 0;
  db.sessioni = 0;
  db.stripeCade = 0;
  db.chiuse.length = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('R03-011 · il benvenuto restituito dal tentativo abbandonato vale subito al tentativo dopo', () => {
  it('carta rifiutata, Maria cambia la fascia e ripreme «Paga» 30 secondi dopo: la cassa si apre col benvenuto', async () => {
    const primo = await paga(FASCE_DI_DOMANI[0]);
    expect(primo.stato, JSON.stringify(primo.corpo)).toBe(200);
    expect(db.buoni[0].uses_count).toBe(1);

    avanti(30);
    const secondo = await paga(FASCE_DI_DOMANI[1]);
    expect(db.chiuse, 'la pagina di pagamento vecchia doveva chiudersi').toEqual(['cs_1']);
    expect(secondo.stato, `il benvenuto restituito resta bloccato: ${JSON.stringify(secondo.corpo)}`).toBe(200);
    expect(db.buoni[0].uses_count, 'un uso solo: quello della cassa nuova').toBe(1);
    expect(aperte().map((r) => r.id), 'resta aperta solo la rivendicazione della cassa nuova').toEqual(['riv-2']);
  });

  it('si chiude solo la rivendicazione del tentativo liberato, non le altre del cliente', async () => {
    // Una rivendicazione vecchia dello stesso cliente che non appartiene a nessuna cassa liberata.
    db.rivendicazioni.push({ id: 'riv-altra', coupon_id: 'buono-benvenuto', user_id: CLIENTE, claimed_at: new Date(Date.now() - 10 * 60_000).toISOString(), released_at: null });
    db.numero = 0;
    const primo = await paga(FASCE_DI_DOMANI[0]);
    expect(primo.stato, JSON.stringify(primo.corpo)).toBe(200);
    avanti(30);
    const secondo = await paga(FASCE_DI_DOMANI[1]);
    expect(secondo.stato, JSON.stringify(secondo.corpo)).toBe(200);
    expect(db.rivendicazioni.find((r) => r.id === 'riv-altra')?.released_at ?? null, 'chiusa una rivendicazione che non era del tentativo liberato').toBeNull();
  });
});
