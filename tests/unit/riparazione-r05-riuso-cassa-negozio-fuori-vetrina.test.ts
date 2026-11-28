import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R05-008 — Il riuso della pagina di Stripe guarda gli orari di OGNI negozio del carrello.
 *
 * La vetrina pubblica (`seller_public_profiles`) non restituisce tutti i negozi che vendono: un
 * negozio approvato in modalità demo (fuori vetrina) o senza insegna non c'è. La richiesta nuova
 * lo riprende dal profilo col client di servizio; il riuso no, e il negozio mancante saltava il
 * controllo «negozio chiuso». Mercoledì 25/11 alle 12:00 il cliente apre la cassa per «Oggi ·
 * 13:00–16:30» da un forno fuori vetrina (9-13 e 16:30-19:30); alle 14:00 rimanda lo stesso
 * carrello: il forno riapre alle 16:30, una richiesta nuova prende 409, la rotta restituiva la
 * pagina vecchia. Con la lettura dei negozi caduta, al riuso si guardava solo l'orologio.
 *
 * Orari veri (`lib/store-hours` non è finto), Supabase e Stripe finti, orologio finto.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const FASCIA = 'Oggi · 13:00–16:30';
const MESSAGGIO_LETTURA_CADUTA = 'Non riusciamo a controllare il negozio in questo momento. Riprova fra poco.';

const { stato } = vi.hoisted(() => {
  const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
  return {
    stato: {
      /** Il forno com'è scritto nel profilo (lo legge il client di servizio). */
      profilo: {
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        store_name: 'Forno Demo',
        store_lat: 45.05,
        store_lng: 9.69,
        store_hours: { mon: giorno, tue: giorno, wed: giorno, thu: giorno, fri: giorno, sat: giorno, sun: [] },
        role: 'seller',
        is_approved: true,
      },
      /** Il forno sta nella vetrina pubblica? In modalità demo no. */
      inVetrina: false,
      /** La lettura della vetrina cade. */
      vetrinaInErrore: false,
      /** La lettura dei profili col client di servizio cade. */
      profiliInErrore: false,
    },
  };
});

/** Le righe di intento scritte davvero. */
const intenti: Array<{ id: string; buyer_id: string; status: string; delivery: Record<string, unknown>; stripe_session_id: string | null; expires_at: string }> = [];
const sessioniCreate: string[] = [];

// Al lancio la carta è spenta (CARTA_ACCESA): questa prova misura il percorso della carta.
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  CARTA_ACCESA: true,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (
    _opts: unknown,
    h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: Request }) => unknown,
  ) => (req: Request) => h({
    user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
    profile: { role: 'buyer', is_approved: true },
    req,
  }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: vi.fn(async () => {
    const id = `cs_${sessioniCreate.length + 1}`;
    sessioniCreate.push(id);
    return { id, url: `https://stripe.test/${id}` };
  }),
  // La pagina di prima è ancora apribile: è il caso di chi torna indietro.
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, status: 'open', url: `https://stripe.test/${id}` }),
        expire: async (id: string) => ({ id, status: 'expired' }),
      },
    },
  }),
}));
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 490), compensoRiderCents: vi.fn(() => 300) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: P1, seller_id: S1, name: 'Pane', price: 10, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  /** Le letture fatte con la sessione del cliente: la vetrina vede solo i negozi in vetrina. */
  const letture = (table: string) => ({
    select: () => ({
      in: () => {
        if (table === 'products') return Promise.resolve({ data: prodotti, error: null });
        if (table === 'product_variants') return Promise.resolve({ data: [], error: null });
        if (table === 'seller_public_profiles') {
          if (stato.vetrinaInErrore) return Promise.resolve({ data: null, error: { message: 'vetrina giù' } });
          const { id, store_name, store_lat, store_lng, store_hours } = stato.profilo;
          return Promise.resolve({
            data: stato.inVetrina ? [{ id, store_name, store_lat, store_lng, store_hours }] : [],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
      eq: () => Promise.resolve({ data: [], error: null }),
    }),
  });

  /** La tabella degli intenti, con il filtro sull'impronta del carrello. */
  const tabellaIntenti = () => ({
    select: () => {
      const filtri: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        eq: (col: string, v: unknown) => { filtri[col] = v; return b; },
        gt: () => b,
        filter: (col: string, _op: string, v: unknown) => { filtri[col] = v; return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: () => {
          const trovato = intenti.find((r) =>
            r.buyer_id === filtri.buyer_id &&
            r.status === (filtri.status ?? r.status) &&
            r.delivery.impronta_carrello === filtri['delivery->>impronta_carrello']);
          return Promise.resolve({ data: trovato ?? null, error: null });
        },
      };
      return b;
    },
    insert: (riga: Record<string, unknown>) => ({
      select: () => ({
        single: () => {
          const id = `pc_${intenti.length + 1}`;
          intenti.push({
            id,
            buyer_id: riga.buyer_id as string,
            status: (riga.status as string) ?? 'PENDING',
            delivery: riga.delivery as Record<string, unknown>,
            stripe_session_id: null,
            expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
          });
          return Promise.resolve({ data: { id, expires_at: intenti[intenti.length - 1].expires_at }, error: null });
        },
      }),
    }),
    update: (valori: Record<string, unknown>) => ({
      eq: (_c: string, id: string) => {
        const riga = intenti.find((r) => r.id === id);
        if (riga && typeof valori.stripe_session_id === 'string') riga.stripe_session_id = valori.stripe_session_id;
        if (riga && typeof valori.status === 'string') riga.status = valori.status as string;
        return Promise.resolve({ error: null });
      },
    }),
  });

  const adminFrom = (table: string): Record<string, unknown> => {
    if (table === 'pending_checkouts') return tabellaIntenti() as unknown as Record<string, unknown>;
    // Il profilo del negozio: il client di servizio vede ogni negozio, in vetrina o no.
    if (table === 'profiles') {
      return {
        select: () => ({
          in: (_c: string, ids: string[]) =>
            Promise.resolve(
              stato.profiliInErrore
                ? { data: null, error: { message: 'profili giù' } }
                : { data: ids.includes(stato.profilo.id) ? [stato.profilo] : [], error: null },
            ),
        }),
      };
    }
    if (table === 'consent_log') return { update: () => ({ is: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
    if (table === 'user_addresses') return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    if (table === 'orders') {
      return {
        select: () => ({ in: () => ({ gte: () => Promise.resolve({ data: [], error: null, count: 0 }) }) }),
        insert: () => Promise.resolve({ error: null }),
      };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  };

  const rpc = () => Promise.resolve({ data: null, error: null });

  return {
    getServerSupabase: async () => ({ from: letture, rpc }),
    getAdminSupabase: () => ({ from: adminFrom, rpc }),
  };
});

const carrello = {
  groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 }],
  delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
  pickupInStore: false,
  deliverySlot: FASCIA,
};

async function paga(corpo: unknown = carrello) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const req = new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(req);
  return { stato: res.status, corpo: await res.json() };
}

/** Il messaggio d'errore della risposta, qualunque sia la forma della busta. */
function messaggio(corpo: unknown): string {
  return JSON.stringify(corpo);
}

beforeEach(() => {
  intenti.length = 0;
  sessioniCreate.length = 0;
  stato.inVetrina = false;
  stato.vetrinaInErrore = false;
  stato.profiliInErrore = false;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T11:00:00Z')); // mercoledì, 12:00 a Roma
});
afterEach(() => { vi.useRealTimers(); });

describe('R05-008 — la pagina già aperta non scavalca il «negozio chiuso» di un negozio fuori vetrina', () => {
  it('negozio fuori vetrina e aperto: la pagina di prima si riprende ancora', async () => {
    const primo = await paga();
    expect(primo.stato, messaggio(primo.corpo)).toBe(200);
    vi.setSystemTime(new Date('2026-11-25T11:10:00Z')); // 12:10: il ritiro si comincia ancora entro le 12:45
    const secondo = await paga();
    expect(secondo.stato, messaggio(secondo.corpo)).toBe(200);
    expect(secondo.corpo.data.url).toBe(primo.corpo.data.url);
    expect(sessioniCreate.length).toBe(1);
  });

  it('negozio fuori vetrina chiuso fino alle 16:30: alle 14:00 il riuso dà il 409 della richiesta nuova', async () => {
    expect((await paga()).stato).toBe(200);
    vi.setSystemTime(new Date('2026-11-25T13:00:00Z')); // 14:00 a Roma: il forno riapre alle 16:30

    // Il riferimento: un carrello diverso (due pani) è una richiesta nuova, e prende 409.
    const nuova = await paga({ ...carrello, groups: [{ ...carrello.groups[0], items: [{ productId: P1, quantity: 2 }] }] });
    expect(nuova.stato, messaggio(nuova.corpo)).toBe(409);

    const riuso = await paga();
    expect(riuso.stato, 'la pagina vecchia è stata restituita: il negozio fuori vetrina ha saltato gli orari').toBe(409);
    expect(riuso.corpo.data?.url).toBeUndefined();
    expect(messaggio(riuso.corpo)).toBe(messaggio(nuova.corpo));
    expect(sessioniCreate.length).toBe(1);
  });

  it('lettura della vetrina caduta: niente pagina vecchia, lo stesso 503 della richiesta nuova', async () => {
    stato.inVetrina = true;
    expect((await paga()).stato).toBe(200);
    vi.setSystemTime(new Date('2026-11-25T13:00:00Z')); // 14:00: il forno è chiuso, ma la rotta non lo può sapere
    stato.vetrinaInErrore = true;
    const riuso = await paga();
    expect(riuso.stato, 'con la lettura dei negozi caduta si è guardato solo l’orologio').toBe(503);
    expect(riuso.corpo.data?.url).toBeUndefined();
    expect(messaggio(riuso.corpo)).toContain(MESSAGGIO_LETTURA_CADUTA);
    expect(sessioniCreate.length).toBe(1);
  });

  it('negozio fuori vetrina con la lettura del profilo caduta: niente pagina vecchia, 503', async () => {
    expect((await paga()).stato).toBe(200);
    vi.setSystemTime(new Date('2026-11-25T11:10:00Z'));
    stato.profiliInErrore = true;
    const riuso = await paga();
    expect(riuso.stato).toBe(503);
    expect(riuso.corpo.data?.url).toBeUndefined();
    expect(messaggio(riuso.corpo)).toContain(MESSAGGIO_LETTURA_CADUTA);
  });
});
