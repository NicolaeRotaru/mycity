import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/lib/logger';
import { laChiaveVaButtata } from '@/lib/ordini/chiave-dopo-l-errore';

/**
 * 1/11/2026 — SE L'ANNULLAMENTO FALLISCE, LA CHIAVE RESTA.
 *
 * Spesa da due negozi: l'ordine del forno nasce, al fioraio la merce manca e la
 * cassa annulla l'ordine del forno. Se quella cancellazione torna con un
 * errore, l'ordine del forno resta in piedi: la chiave non si puo' liberare,
 * se no il browser la butta e il tocco dopo crea un secondo ordine al forno.
 * Lo stesso quando gli articoli di un ordine non si salvano e la sua
 * cancellazione cade. Database finto della prova sorella
 * (la-cassa-in-contanti-non-perde-e-non-ricicla-la-chiave), con in piu' una
 * cancellazione che cade e una riserva della merce che fallisce al secondo
 * negozio.
 *
 * (Intestazione della prova sorella:)
 *
 * Quattro modi in cui lo stesso carrello diventava due ordini, o l'ordine di
 * adesso spariva dietro a uno vecchio. Il database finto e' quello della prova
 * sorella (la-chiave-dei-contanti-ritrova-solo-i-suoi-ordini): chiave primaria
 * vera sugli ordini, filtri veri. In piu' sa fare tre cose cattive: salvare
 * l'ordine e rispondere con un errore, morire subito dopo il salvataggio, e
 * far arrivare prima un invio gemello della stessa chiave.
 */

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
  cancellaOrdineFallisce: false,
  articoliFalliscono: false,
  riservaFallisceAl: 0,
  riserve: 0,
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
      if (op === 'insert' && nome === 'order_items' && stato.articoliFalliscono) {
        return { data: null, error: { message: 'articoli non salvati' } };
      }
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
        if (nome === 'orders' && stato.cancellaOrdineFallisce) return { data: null, error: { message: 'cancellazione caduta' } };
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
      rpc: (nome: string) => {
        if (nome === 'reserve_stock') {
          stato.riserve++;
          if (stato.riservaFallisceAl === stato.riserve) return Promise.resolve({ data: null, error: { message: 'stock insufficiente' } });
        }
        return Promise.resolve({ data: null, error: null });
      },
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
  const corpo = (await res.json()) as Riga;
  return { res, corpo };
}

const alForno = () => stato.ordini.filter((o) => o.seller_id === FORNO);
const chiaveOccupata = (k: string) => stato.tentativi.some((t) => t.chiave === k);

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
  stato.cancellaOrdineFallisce = false;
  stato.articoliFalliscono = false;
  stato.riservaFallisceAl = 0;
  stato.riserve = 0;
  vi.mocked(logger.error).mockClear();
});

describe('due negozi, il secondo senza merce, la cancellazione del primo cade', () => {
  it('l ordine del forno resta in piedi: la chiave non si libera e il browser non la butta', async () => {
    stato.riservaFallisceAl = 2;
    stato.cancellaOrdineFallisce = true;
    const { res, corpo } = await ordina('cod-annulla-caduto', [AL_FORNO, AL_FIORAIO]);
    expect(res.ok).toBe(false);
    expect(alForno(), 'la prova non ricrea il caso: il forno non ha un ordine rimasto').toHaveLength(1);
    expect(chiaveOccupata('cod-annulla-caduto'), 'chiave liberata con l ordine del forno ancora in piedi').toBe(true);
    expect(laChiaveVaButtata(corpo), `il browser butta la chiave e il tocco dopo fa il doppione: ${JSON.stringify(corpo)}`).toBe(false);
    expect(vi.mocked(logger.error), 'nessun allarme per l ordine rimasto in piedi').toHaveBeenCalled();
  });

  it('se la cancellazione riesce, tutto torna pulito e la chiave si libera (caso normale)', async () => {
    stato.riservaFallisceAl = 2;
    const { res, corpo } = await ordina('cod-annulla-riuscito', [AL_FORNO, AL_FIORAIO]);
    expect(res.status).toBe(409);
    expect(alForno()).toHaveLength(0);
    expect(laChiaveVaButtata(corpo)).toBe(true);
  });
});

describe('un negozio, gli articoli non si salvano e la cancellazione dell ordine cade', () => {
  it('l ordine senza articoli resta: la chiave non si libera', async () => {
    stato.articoliFalliscono = true;
    stato.cancellaOrdineFallisce = true;
    const { res, corpo } = await ordina('cod-articoli-caduti', [AL_FORNO]);
    expect(res.ok).toBe(false);
    expect(alForno()).toHaveLength(1);
    expect(chiaveOccupata('cod-articoli-caduti'), 'chiave liberata con l ordine senza articoli ancora in piedi').toBe(true);
    expect(laChiaveVaButtata(corpo)).toBe(false);
  });

  it('se la cancellazione riesce, niente ordine e chiave liberata', async () => {
    stato.articoliFalliscono = true;
    const { res, corpo } = await ordina('cod-articoli-caduti-ok', [AL_FORNO]);
    expect(res.ok).toBe(false);
    expect(alForno()).toHaveLength(0);
    expect(laChiaveVaButtata(corpo)).toBe(true);
  });
});
