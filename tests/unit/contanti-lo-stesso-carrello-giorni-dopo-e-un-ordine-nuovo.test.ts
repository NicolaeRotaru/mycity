import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/lib/logger';
import { chiaveTentativo } from '@/lib/ordini/tentativo';

/**
 * 31/10/2026 — LO STESSO CARRELLO, GIORNI DOPO, E' UN ORDINE NUOVO.
 *
 * Il collaudo dell'ondata 3 l'ha trovato cosi': lunedi' Maria ordina il pane in
 * contanti e la risposta si perde sulla rete del telefono. L'ordine nasce, ma il
 * browser non chiude il tentativo: la chiave resta nella scheda, insieme
 * all'impronta del carrello. Mercoledi', nella stessa scheda, lo stesso pane:
 * stessa impronta, stessa chiave. La cassa trovava la riga di lunedi', diceva
 * «fatto» con l'ordine di lunedi' e al forno non arrivava niente.
 *
 * Una chiave vale per UN tentativo: un invio ripetuto arriva entro minuti, non
 * giorni. Una riga piu' vecchia della finestra non si riusa: si passa alla
 * generazione dopo della stessa chiave, che resta pero' sempre la stessa per i
 * ritocchi di mercoledi' — il doppione non nasce nemmeno li'.
 *
 * Il database finto e' quello della prova sorella
 * (la-cassa-in-contanti-non-perde-e-non-ricicla-la-chiave): chiave primaria vera
 * sugli ordini e sulle chiavi, filtri veri.
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
  tentativi: [] as Riga[],
  profili: [] as Riga[],
  vetrina: null as null | { data: Riga[] | null; error: { message: string } | null },
  negozi: [] as Riga[],
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
  /** Le colonne su cui ogni tabella finta filtra davvero: le altre condizioni non toccano questi dati. */
  const colonne: Record<string, string[]> = {
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
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from: tavola }),
  };
});

const AL_FORNO = { sellerId: FORNO, items: [{ productId: PANE, quantity: 1 }] };
const AL_FIORAIO = { sellerId: FIORAIO, items: [{ productId: FIORI, quantity: 1 }] };

async function ordina(chiave: string, gruppi = [AL_FORNO]) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
    body: JSON.stringify({
      groups: gruppi,
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  });
  let res: Response;
  try {
    res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  } catch {
    // La funzione e' morta: la piattaforma risponde una pagina che non e' JSON.
    return { res: { ok: false, status: 504 } as Response, corpo: {} as Riga, ids: [] as string[] };
  }
  const corpo = (await res.json()) as Riga & { data?: { orderIds?: string[] }; orderIds?: string[] };
  return { res, corpo, ids: corpo.data?.orderIds ?? corpo.orderIds ?? [] };
}


const alForno = () => stato.ordini.filter((o) => o.seller_id === FORNO);

beforeEach(() => {
  stato.ordini.length = 0;
  stato.tentativi.length = 0;
  stato.profili.length = 0;
  stato.negozi.length = 0;
  stato.negozi.push(
    { id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
    { id: FIORAIO, store_name: 'Fiori di Via Roma', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
  );
  stato.vetrina = null;
  vi.mocked(logger.error).mockClear();
});

/** Il `sessionStorage` di una scheda. */
function scheda() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}


const IMPRONTA_DEL_PANE = `${FORNO}=${PANE}::1`;
const ORA = 3_600_000;
const GIORNO = 86_400_000;

/** Sposta indietro nel tempo tutto quello che c'e' nel database finto: chiavi e ordini. */
function passano(ms: number) {
  for (const r of [...stato.tentativi, ...stato.ordini]) {
    r.created_at = new Date(new Date(r.created_at as string).getTime() - ms).toISOString();
  }
}

/** Lo stesso pane nella stessa scheda: la chiave la decide il browser vero (sessionStorage + impronta). */
function laScheda() {
  const s = scheda();
  let n = 0;
  return () => chiaveTentativo(s, () => `cod-scheda-${++n}`, undefined, IMPRONTA_DEL_PANE);
}

describe('lunedi la risposta si perde al forno, mercoledi lo stesso pane nella stessa scheda', () => {
  it("mercoledi nasce un ordine nuovo: la cassa non risponde «fatto» con quello di lunedi", async () => {
    const chiave = laScheda();
    await ordina(chiave()); // lunedi: l'ordine nasce, la risposta si perde
    expect(alForno()).toHaveLength(1);
    const diLunedi = alForno()[0].id;
    passano(2 * GIORNO);

    const { res, ids } = await ordina(chiave()); // mercoledi
    expect(res.status).toBe(200);
    expect(ids, "la cassa ha detto «fatto» con l'ordine di lunedi").not.toContain(diLunedi);
    expect(alForno(), 'mercoledi al forno non e arrivato niente').toHaveLength(2);
    expect(alForno().every((o) => o.user_id === CLIENTE)).toBe(true);
  });

  it("se anche la risposta di mercoledi si perde, il ritocco ritrova l'ordine di mercoledi: niente terzo pane", async () => {
    const chiave = laScheda();
    await ordina(chiave()); // lunedi, risposta persa
    passano(3 * GIORNO);
    const mercoledi = await ordina(chiave()); // mercoledi, anche questa risposta si perde
    expect(mercoledi.ids).toHaveLength(1);

    const ritocco = await ordina(chiave()); // un minuto dopo, stesso pane, stessa scheda
    expect(ritocco.res.status).toBe(200);
    expect(ritocco.ids, "il ritocco deve ritrovare l'ordine di mercoledi").toEqual(mercoledi.ids);
    expect(alForno(), 'il ritocco di mercoledi ha creato un TERZO ordine').toHaveLength(2);
  });

  it('venerdi, con due risposte perse alle spalle: nasce il terzo ordine, uno per giorno', async () => {
    const chiave = laScheda();
    await ordina(chiave()); // lunedi
    passano(2 * GIORNO);
    await ordina(chiave()); // mercoledi
    passano(2 * GIORNO);
    const venerdi = await ordina(chiave());
    expect(venerdi.res.status).toBe(200);
    expect(new Set(alForno().map((o) => o.id)).size, 'venerdi al forno non e arrivato niente').toBe(3);
  });
});

describe('un ritocco vero, poco dopo, resta lo stesso tentativo', () => {
  it("la risposta si perde e dopo un'ora lo stesso pane: la cassa restituisce l'ordine di prima, non ne fa un altro", async () => {
    const chiave = laScheda();
    const primo = await ordina(chiave());
    passano(ORA);
    const { res, ids } = await ordina(chiave());
    expect(res.status).toBe(200);
    expect(ids).toEqual(primo.ids);
    expect(alForno(), "un ritocco dopo un'ora ha fatto il doppione").toHaveLength(1);
  });

  it('due giorni dopo, un altro negozio nella stessa scheda arriva al suo negozio', async () => {
    const chiave = laScheda();
    await ordina(chiave());
    passano(2 * GIORNO);
    const altra = chiaveTentativo(scheda(), () => 'cod-fioraio', undefined, `${FIORAIO}=${FIORI}::1`);
    const { res } = await ordina(altra, [AL_FIORAIO]);
    expect(res.status).toBe(200);
    expect(stato.ordini.filter((o) => o.seller_id === FIORAIO)).toHaveLength(1);
  });
});
