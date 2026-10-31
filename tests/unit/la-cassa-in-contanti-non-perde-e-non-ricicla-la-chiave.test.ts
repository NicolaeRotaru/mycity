import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/lib/logger';
import { idOrdiniDelTentativo, laChiaveVaButtata } from '@/lib/ordini/chiave-dopo-l-errore';
import { chiaveTentativo, chiudiTentativo } from '@/lib/ordini/tentativo';

/**
 * 31/10/2026 — LA CASSA IN CONTANTI NON PERDE LA CHIAVE E NON LA RICICLA.
 *
 * Quattro modi in cui lo stesso carrello diventava due ordini, o l'ordine di
 * adesso spariva dietro a uno vecchio. Il database finto e' quello della prova
 * sorella (la-chiave-dei-contanti-ritrova-solo-i-suoi-ordini): chiave primaria
 * vera sugli ordini, filtri veri. In piu' sa fare tre cose cattive: salvare
 * l'ordine e rispondere con un errore, morire subito dopo il salvataggio, e
 * far arrivare prima un invio gemello della stessa chiave.
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
  provaFallisce: false,
  rivendicaGuasta: false,
  letturaOrdiniFallisce: 0,
  salvatoMaRispostaPersa: 0,
  muoreDopoLOrdine: false,
  primaDellOrdine: null as null | (() => void),
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
          stato.primaDellOrdine?.();
          if (stato.ordini.some((o) => o.id === id)) return { data: null, error: { code: '23505', message: 'duplicate key orders_pkey' } };
          stato.ordini.push({ ...valori, id, created_at: new Date().toISOString() });
          if (stato.muoreDopoLOrdine) {
            stato.muoreDopoLOrdine = false;
            throw new Error('FUNCTION_INVOCATION_TIMEOUT');
          }
          if (stato.salvatoMaRispostaPersa > 0) {
            stato.salvatoMaRispostaPersa--;
            return { data: null, error: { code: '08006', message: 'connessione persa dopo il salvataggio' } };
          }
          return { data: { id }, error: null };
        }
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
  stato.salvatoMaRispostaPersa = 0;
  stato.muoreDopoLOrdine = false;
  stato.primaDellOrdine = null;
  vi.mocked(logger.error).mockClear();
});

const SPARITO = '33333333-3333-4333-8333-333333333333';

/** Il `sessionStorage` di una scheda. */
function scheda() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('il database salva l ordine ma la risposta torna con un errore', () => {
  it('la cassa va avanti con l ordine che c e: un ordine solo, e il carrello si svuota', async () => {
    stato.salvatoMaRispostaPersa = 1;
    const b = browser('cod-salvato-risposta-persa');
    const primo = await b.tocca();
    expect(primo?.res.status, `l'ordine c'e' ma la cassa lo tratta come mai nato: ${JSON.stringify(primo?.corpo)}`).toBe(200);
    expect(b.carrelloPieno, 'il carrello è rimasto pieno: il cliente ritoccherà «Ordina»').toBe(false);
    await b.tocca();
    expect(alForno(), 'SECONDO ordine sullo stesso carrello').toHaveLength(1);
  });
});

describe('dopo un errore il browser butta la chiave solo se il server l ha liberata', () => {
  it('una risposta che non si sa leggere (la funzione caduta a metà) tiene la chiave', () => {
    expect(laChiaveVaButtata({}), 'risposta non JSON letta come {}: chiave buttata col carrello pieno').toBe(false);
    expect(laChiaveVaButtata(undefined)).toBe(false);
    expect(laChiaveVaButtata(null)).toBe(false);
  });

  it('la funzione muore dopo aver creato l ordine, «Ordina» dopo un minuto: un ordine solo', async () => {
    stato.muoreDopoLOrdine = true;
    const b = browser('cod-caduta-a-meta');
    const primo = await b.tocca();
    expect(primo?.res.ok).toBe(false);
    expect(alForno()).toHaveLength(1);
    invecchia('cod-caduta-a-meta');
    await b.tocca();
    expect(alForno(), 'SECONDO ordine sullo stesso carrello: la chiave nuova non conosce quello nato').toHaveLength(1);
    expect(b.carrelloPieno).toBe(false);
  });

  it('un errore normale libera la chiave e lo dice, così chi corregge il carrello riparte pulito', async () => {
    const { res, corpo } = await ordina('cod-prodotto-sparito', [
      { sellerId: FORNO, items: [{ productId: PANE, quantity: 1 }, { productId: SPARITO, quantity: 1 }] },
    ]);
    expect(res.ok).toBe(false);
    expect(stato.tentativi.some((t) => t.chiave === 'cod-prodotto-sparito'), 'la chiave è rimasta occupata').toBe(false);
    expect(laChiaveVaButtata(corpo), `il server ha liberato la chiave ma non lo dice: ${JSON.stringify(corpo)}`).toBe(true);
  });
});

describe('la chiave è di quel carrello, non della scheda', () => {
  it('lo stesso carrello ritrova la chiave, un carrello diverso ne ha una nuova', () => {
    const s = scheda();
    let n = 0;
    const genera = () => `k${++n}`;
    const prima = chiaveTentativo(s, genera, undefined, `${FORNO}=${PANE}::1`);
    expect(chiaveTentativo(s, genera, undefined, `${FORNO}=${PANE}::1`), 'lo stesso invio ripetuto deve ritrovare la chiave').toBe(prima);
    const altra = chiaveTentativo(s, genera, undefined, `${FIORAIO}=${FIORI}::1`);
    expect(altra, 'carrello cambiato, stessa chiave: la cassa restituirà gli ordini vecchi').not.toBe(prima);
    chiudiTentativo(s);
    expect(chiaveTentativo(s, genera, undefined, `${FIORAIO}=${FIORI}::1`)).not.toBe(altra);
  });

  it('risposta persa al forno, poi nella stessa scheda un ordine al fioraio: arriva al fioraio', async () => {
    const s = scheda();
    let n = 0;
    const genera = () => `cod-scheda-${++n}`;
    await ordina(chiaveTentativo(s, genera, undefined, `${FORNO}=${PANE}::1`), [AL_FORNO]); // la risposta si perde
    const { res, ids } = await ordina(chiaveTentativo(s, genera, undefined, `${FIORAIO}=${FIORI}::1`), [AL_FIORAIO]);
    expect(res.status).toBe(200);
    expect(ids, 'la cassa ha detto «fatto» con l ordine vecchio del forno').not.toContain(alForno()[0]?.id);
    expect(stato.ordini.filter((o) => o.seller_id === FIORAIO), 'al fioraio non è arrivato niente').toHaveLength(1);
  });
});

describe('un invio gemello della stessa chiave ha già creato l ordine', () => {
  it('il secondo dice «in corso», tiene la chiave e al tocco dopo ritrova l ordine del gemello', async () => {
    const chiave = 'cod-gemello-lento';
    stato.tentativi.push({ chiave, user_id: CLIENTE, order_ids: [], created_at: new Date(Date.now() - 90_000).toISOString() });
    const [idGemello] = await idOrdiniDelTentativo(chiave, CLIENTE, 1);
    // Il primo invio, lentissimo, crea l'ordine un istante prima del ritocco.
    stato.primaDellOrdine = () => {
      stato.primaDellOrdine = null;
      stato.ordini.push({ id: idGemello, user_id: CLIENTE, seller_id: FORNO, total_price: 7.5, payment_method: 'cod', created_at: new Date().toISOString() });
    };
    const b = browser(chiave);
    const primo = await b.tocca();
    expect(primo?.res.ok).toBe(false);
    expect(laChiaveVaButtata(primo?.corpo), 'il browser butta la chiave del gemello: il tocco dopo fa il doppione').toBe(false);
    // Il gemello finisce e riempie la riga della chiave.
    for (const t of stato.tentativi) if (t.chiave === chiave) t.order_ids = [{ id: idGemello, sellerId: FORNO, totalCents: 750 }];
    await b.tocca();
    expect(alForno(), 'SECONDO ordine sullo stesso carrello').toHaveLength(1);
    expect(b.carrelloPieno, 'il cliente non vede mai il suo ordine').toBe(false);
  });
});
