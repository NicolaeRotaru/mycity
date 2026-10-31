import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/lib/logger';
import { idOrdiniDelTentativo, laChiaveVaButtata } from '@/lib/ordini/chiave-dopo-l-errore';

/**
 * 29/10/2026 — LA CASSA IN CONTANTI: UN ORDINE PER CARRELLO, NE' DUE NE' ZERO.
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
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  const corpo = (await res.json()) as Riga & { data?: { orderIds?: string[] }; orderIds?: string[] };
  return { res, corpo, ids: corpo.data?.orderIds ?? corpo.orderIds ?? [] };
}

/** Il browser della cassa, ridotto a cio' che decide la chiave e il carrello. */
function browser(chiaveIniziale: string, gruppi = [AL_FORNO]) {
  let chiave = chiaveIniziale;
  let nuove = 0;
  let carrelloPieno = true;
  return {
    get carrelloPieno() {
      return carrelloPieno;
    },
    async tocca() {
      if (!carrelloPieno) return null;
      const esito = await ordina(chiave, gruppi);
      if (esito.res.ok) carrelloPieno = false;
      else if (laChiaveVaButtata(esito.corpo)) chiave = `${chiaveIniziale}-nuova-${++nuove}`;
      return esito;
    },
  };
}

/** Un minuto e mezzo dopo: la riga della chiave e' quella di un invio morto per strada. */
function invecchia(chiave: string) {
  for (const t of stato.tentativi) if (t.chiave === chiave) t.created_at = new Date(Date.now() - 90_000).toISOString();
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
  vi.mocked(logger.error).mockClear();
});

describe('la chiave abbandonata ritrova solo gli ordini nati da lei', () => {
  it("l'ordine in contanti di un'altra scheda non viene preso per questo carrello: l'ordine di adesso nasce", async () => {
    const chiave = 'cod-scheda-uno';
    stato.tentativi.push({ chiave, user_id: CLIENTE, order_ids: [], created_at: new Date(Date.now() - 120_000).toISOString() });
    // Dall'altra scheda, un minuto fa: un ordine in contanti vero, allo stesso forno.
    stato.ordini.push({ id: 'ord-altra-scheda', user_id: CLIENTE, seller_id: FORNO, total_price: 7.5, payment_method: 'cod', created_at: new Date(Date.now() - 60_000).toISOString() });

    const { res, corpo, ids } = await ordina(chiave);

    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(ids, "la cassa ha preso per suo l'ordine dell'altra scheda e quello di adesso non è nato").not.toContain('ord-altra-scheda');
    expect(alForno(), "al forno doveva arrivare anche l'ordine di adesso").toHaveLength(2);
  });

  it('prova non scritta, risposta persa, dopo un minuto «Ordina» due volte: un ordine solo', async () => {
    stato.provaFallisce = true;
    const primo = await ordina('cod-prova-persa'); // nasce l'ordine, la risposta si perde per strada
    expect(primo.res.status).toBe(200);
    expect(alForno()).toHaveLength(1);
    expect(
      vi.mocked(logger.error).mock.calls.some((c) => String(c[0]).includes('NON scritta')),
      'la prova non scritta deve far scattare l allarme con la cifra',
    ).toBe(true);

    invecchia('cod-prova-persa');
    const b = browser('cod-prova-persa');
    await b.tocca();
    await b.tocca();
    expect(alForno(), 'SECONDO ordine sullo stesso carrello').toHaveLength(1);
    expect(b.carrelloPieno, 'il carrello è rimasto pieno: il cliente ritoccherà «Ordina»').toBe(false);
  });

  it('se la lettura degli ordini cade sulla chiave abbandonata, la chiave resta e il tocco dopo non crea il doppione', async () => {
    stato.provaFallisce = true;
    await ordina('cod-lettura-giu');
    invecchia('cod-lettura-giu');
    stato.letturaOrdiniFallisce = 1;
    const b = browser('cod-lettura-giu');
    const secondo = await b.tocca();
    expect(secondo?.res.status).toBe(503);
    expect(laChiaveVaButtata(secondo?.corpo), 'il browser butta la chiave: il tocco dopo crea il secondo ordine').toBe(false);
    await b.tocca();
    expect(alForno(), 'SECONDO ordine sullo stesso carrello').toHaveLength(1);
  });

  it("su un carrello di due negozi nato solo a metà la cassa si ferma: non dice «fatto» e non rifà l'ordine al forno", async () => {
    const chiave = 'cod-a-meta';
    const nato = new Date(Date.now() - 120_000).toISOString();
    stato.tentativi.push({ chiave, user_id: CLIENTE, order_ids: [], created_at: nato });
    const [idDelForno] = await idOrdiniDelTentativo(chiave, CLIENTE, 1);
    stato.ordini.push({ id: idDelForno, user_id: CLIENTE, seller_id: FORNO, total_price: 7.5, payment_method: 'cod', created_at: new Date(Date.now() - 100_000).toISOString() });

    const b = browser(chiave, [AL_FORNO, AL_FIORAIO]);
    const secondo = await b.tocca();
    expect(secondo?.res.ok, `la cassa dice «fatto» e il fioraio non riceve niente: ${JSON.stringify(secondo?.corpo)}`).toBe(false);
    expect(laChiaveVaButtata(secondo?.corpo), 'il browser butta la chiave: il tocco dopo rifà tutto').toBe(false);
    await b.tocca();
    expect(alForno(), "l'ordine al forno è nato due volte").toHaveLength(1);
    expect(
      vi.mocked(logger.error).mock.calls.some((c) => String(c[0]).includes('solo in parte')),
      'nessun allarme: la correzione a mano non parte',
    ).toBe(true);
  });
});

describe('quando la chiave non si riesce a registrare, il browser la tiene', () => {
  it('risposta persa, poi la registrazione della chiave cade: il tocco dopo non crea il secondo ordine', async () => {
    await ordina('cod-registro-giu'); // nasce, la risposta si perde
    stato.rivendicaGuasta = true;
    const b = browser('cod-registro-giu');
    const secondo = await b.tocca();
    expect(secondo?.res.status).toBe(503);
    expect(laChiaveVaButtata(secondo?.corpo), 'il browser butta la chiave con gli ordini già nati').toBe(false);
    stato.rivendicaGuasta = false;
    await b.tocca();
    expect(alForno(), 'SECONDO ordine sullo stesso carrello').toHaveLength(1);
    expect(b.carrelloPieno).toBe(false);
  });
});

describe('una lettura dei negozi corta ferma l ordine', () => {
  it('la vetrina torna vuota e il forno è chiuso: l ordine non nasce', async () => {
    stato.vetrina = { data: [], error: null };
    stato.profili.push({ id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: 'chiuso', role: 'seller', is_approved: true });
    const { res } = await ordina('cod-vetrina-vuota');
    expect(res.status).toBe(409);
    expect(stato.ordini, "un ordine verso un negozio chiuso: il fattorino va a vuoto").toHaveLength(0);
  });

  it('la vetrina torna con un errore: l ordine non nasce', async () => {
    stato.vetrina = { data: null, error: { message: 'permesso negato' } };
    const { res } = await ordina('cod-vetrina-giu');
    expect(res.status).toBe(503);
    expect(stato.ordini).toHaveLength(0);
  });

  it('il negozio non è più approvato fra il carrello e la cassa: l ordine non nasce', async () => {
    stato.vetrina = { data: [], error: null };
    stato.profili.push({ id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null, role: 'seller', is_approved: false });
    const { res } = await ordina('cod-non-approvato');
    expect(res.status).toBe(409);
    expect(stato.ordini).toHaveLength(0);
  });
});

describe('gli identificativi degli ordini nascono dalla chiave', () => {
  it('stessa chiave e stessa persona danno gli stessi identificativi; basta cambiarne una e cambiano', async () => {
    const a = await idOrdiniDelTentativo('k1', CLIENTE, 3);
    expect(a).toEqual(await idOrdiniDelTentativo('k1', CLIENTE, 3));
    expect(new Set(a).size).toBe(3);
    for (const id of a) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await idOrdiniDelTentativo('k2', CLIENTE, 1))[0]).not.toBe(a[0]);
    expect((await idOrdiniDelTentativo('k1', 'cliente-2', 1))[0]).not.toBe(a[0]);
  });
});
