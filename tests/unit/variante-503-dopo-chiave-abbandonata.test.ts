import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/lib/logger';
import { laChiaveVaButtata } from '@/lib/ordini/chiave-dopo-l-errore';

/**
 * 28/10/2026 — DOPO «IL TUO ORDINE È GIÀ ARRIVATO» NON DEVE NASCERNE UN ALTRO.
 *
 * La storia vera: il cliente tocca «Ordina», gli ordini nascono, ma la riga che li lega alla chiave
 * non si scrive e la risposta si perde sulla rete del telefono. Dopo un minuto ritocca «Ordina».
 * La rotta guardava gli ordini veri e rispondeva 409 «già arrivato», ma senza `inCorso`. Il
 * browser (app/checkout/page.tsx, `laChiaveVaButtata`) su ogni errore senza `inCorso` butta la
 * chiave e lascia il carrello pieno: al tocco dopo parte una chiave nuova, e nasce il SECONDO
 * ordine. Merce scalata due volte, credito tolto due volte.
 *
 * Questa prova rifà il browser vero, passo per passo: risposta riuscita = carrello svuotato;
 * errore senza `inCorso` = chiave buttata; carrello ancora pieno = il cliente ritocca.
 * Autenticazione e database sono finti; la rotta è vera.
 */

const NEGOZIO_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const NEGOZIO = { lat: 45.0526, lng: 9.6929, nome: 'Pane Quotidiano' };

const stato: {
  aperto: boolean;
  venditori: { data: unknown[] | null; error: { message: string } | null };
  riga: { order_ids: unknown[]; created_at: string } | null;
  provaFallisce: boolean;
  scrittureProva: number;
  letturaOrdiniFallisce: number;
} = {
  aperto: true,
  venditori: { data: [], error: null },
  riga: null,
  provaFallisce: false,
  scrittureProva: 0,
  letturaOrdiniFallisce: 0,
};
const ordiniCreati: Array<Record<string, unknown>> = [];
const profili: unknown[] = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _o: unknown,
      h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
    ) =>
    (req: unknown) =>
      h({
        user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => stato.aperto),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessun codice' })) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: vi.fn() }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => NEGOZIO) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: PRODOTTO, seller_id: NEGOZIO_ID, name: 'Pane', price: 12, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const catena = (lista: () => unknown, singolo: unknown = { data: null, error: null }) => {
    const b: Record<string, unknown> = {};
    for (const passo of ['select', 'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'filter', 'order', 'limit', 'not', 'or', 'update', 'upsert', 'delete', 'insert']) {
      b[passo] = () => b;
    }
    b.single = () => Promise.resolve(singolo);
    b.maybeSingle = () => Promise.resolve(singolo);
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(lista()).then(ok, ko);
    return b;
  };
  /** La riga della chiave: una sola per cliente, con chiave primaria vera (il secondo inserimento è un 23505). */
  const tentativi = (): Record<string, unknown> => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let valori: { order_ids?: unknown[] } = {};
    const b: Record<string, unknown> = {};
    for (const passo of ['select', 'eq', 'order', 'limit']) b[passo] = () => b;
    b.insert = () => ((op = 'insert'), b);
    b.update = (v: { order_ids?: unknown[] }) => ((op = 'update'), (valori = v), b);
    b.delete = () => ((op = 'delete'), b);
    b.maybeSingle = () => Promise.resolve({ data: stato.riga, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let esito: unknown = { data: [], error: null };
      if (op === 'insert') {
        if (stato.riga) esito = { error: { code: '23505', message: 'duplicate key' } };
        else {
          stato.riga = { order_ids: [], created_at: new Date().toISOString() };
          esito = { error: null };
        }
      } else if (op === 'update') {
        stato.scrittureProva++;
        if (stato.provaFallisce) esito = { error: { message: 'rete caduta' } };
        else {
          if (stato.riga) stato.riga.order_ids = valori.order_ids ?? [];
          esito = { error: null };
        }
      } else if (op === 'delete') {
        stato.riga = null;
        esito = { error: null };
      }
      return Promise.resolve(esito).then(ok, ko);
    };
    return b;
  };
  const from = (tavola: string): Record<string, unknown> => {
    if (tavola === 'products') return catena(() => ({ data: prodotti, error: null }));
    if (tavola === 'seller_public_profiles') return catena(() => stato.venditori);
    if (tavola === 'cod_checkout_attempts') return tentativi();
    if (tavola === 'profiles') return catena(() => ({ data: profili, error: null }));
    if (tavola === 'orders') {
      // Una lettura degli ordini restituisce quelli nati finora, come farebbe il database.
      const c = catena(() => (stato.letturaOrdiniFallisce > 0 && stato.letturaOrdiniFallisce-- > 0) ? ({ data: null, error: { message: 'timeout di rete' } }) : ({
        data: ordiniCreati.map((o, i) => ({ id: `ord-${i + 1}`, seller_id: o.seller_id, total_price: o.total_price })),
        error: null,
      }));
      c.insert = (riga: unknown) => {
        ordiniCreati.push((Array.isArray(riga) ? riga[0] : riga) as Record<string, unknown>);
        const id = `ord-${ordiniCreati.length}`;
        return catena(() => ({ data: [{ id }], error: null }), { data: { id }, error: null });
      };
      return c;
    }
    return catena(() => ({ data: [], error: null }));
  };
  return {
    getAdminSupabase: () => ({
      from,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from }),
  };
});

const NEGOZIO_IN_VETRINA = { id: NEGOZIO_ID, store_name: NEGOZIO.nome, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng, store_hours: null };

async function ordina(chiave?: string) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(chiave ? { 'idempotency-key': chiave } : {}) },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO_ID, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  const corpo = (await res.json()) as { ok?: boolean; error?: { message?: string } };
  return { res, corpo };
}

/** Il minuto che passa: la riga della chiave diventa vecchia, come quella di un invio morto per strada. */
function passaUnMinutoEMezzo() {
  if (stato.riga) stato.riga.created_at = new Date(Date.now() - 90_000).toISOString();
}

beforeEach(() => {
  ordiniCreati.length = 0;
  profili.length = 0;
  stato.aperto = true;
  stato.venditori = { data: [NEGOZIO_IN_VETRINA], error: null };
  stato.riga = null;
  stato.provaFallisce = false;
  stato.scrittureProva = 0;
  stato.letturaOrdiniFallisce = 0;
  vi.mocked(logger.error).mockClear();
});


/** Il browser di app/checkout/page.tsx, ridotto a ciò che decide la chiave e il carrello. */
function browser(chiaveIniziale: string) {
  let chiave = chiaveIniziale;
  let carrelloPieno = true;
  return {
    get carrelloPieno() {
      return carrelloPieno;
    },
    async tocca() {
      if (!carrelloPieno) return null;
      const esito = await ordina(chiave);
      if (esito.res.ok) carrelloPieno = false; // onSuccess: chiudiIlTentativo + clearCart
      else if (laChiaveVaButtata(esito.corpo)) {
        chiave = `${chiaveIniziale}-nuova`;
        stato.riga = null; // la chiave nuova non ha riga (il finto database ne tiene una sola)
      }
      return esito;
    },
  };
}

describe('variante: la lettura degli ordini cade una volta, poi il cliente ritocca', () => {
  it('prova non scritta, risposta persa, dopo un minuto «Ordina» con la lettura degli ordini che cade, poi ancora «Ordina»: un ordine solo', async () => {
    stato.provaFallisce = true;
    const b = browser('cod-chiave-del-browser');
    await ordina('cod-chiave-del-browser');
    expect(ordiniCreati).toHaveLength(1);
    passaUnMinutoEMezzo();
    stato.provaFallisce = false;
    stato.letturaOrdiniFallisce = 1;
    const secondo = await b.tocca();
    expect(ordiniCreati).toHaveLength(1);
    const terzo = await b.tocca();
    expect(
      ordiniCreati,
      `2° tocco ${secondo?.res.status} ${JSON.stringify(secondo?.corpo)} · 3° tocco: SECONDO ordine (${terzo?.res.status} ${JSON.stringify(terzo?.corpo)})`,
    ).toHaveLength(1);
  });
});
