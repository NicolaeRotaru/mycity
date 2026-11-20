import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';
import { veloceSiPuo } from '@/lib/ordini/consegna-veloce';

/**
 * 20/11/2026 (R04-021) — LA CONSEGNA VELOCE SI VENDEVA A TUTTI INSIEME ANCHE CON UN SOLO FATTORINO.
 *
 * Il conteggio delle veloci in mano c'era (`contaVelociInCorso`), ma il numero di veloci per fattorino
 * era `null` e la rotta dei contanti non passava il conteggio: dieci clienti alle 11 ricevevano tutti
 * «arrivo in 30-60 minuti». Nicola ha scelto il 19/11 (fatto `consegna.veloce-per-fattorino`): una
 * veloce alla volta per fattorino disponibile.
 *
 * Qui la rotta dei contanti si esegue col database finto: i fattorini e le veloci in corso si contano
 * davvero (`contaFattoriniOnline` e `contaVelociInCorso` non sono finti). Giovedì 19/11/2026 alle 11
 * di Piacenza.
 */

const NEGOZIO = 'aaaaaaaa-0000-4000-8000-000000000001';
const PANE = '11111111-1111-4111-8111-111111111111';
const PIACENZA = { lat: 45.0526, lng: 9.6929 };

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  ordini: [] as Riga[],
  tentativi: [] as Riga[],
  profili: [] as Riga[],
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
vi.mock('@/lib/store-hours', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  negozioPuoServire: vi.fn(() => true),
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
    { id: '11111111-1111-4111-8111-111111111111', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Pane', price: 15, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: true },
  ];
  const negozi: Riga[] = [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', store_name: 'Pane Quotidiano', store_lat: 45.0526, store_lng: 9.6929, store_hours: null },
  ];
  const colonne: Record<string, string[]> = {
    orders: ['id', 'user_id', 'payment_method', 'created_at', 'delivery_slot', 'delivery_status'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    profiles: ['id', 'role', 'is_approved', 'rider_is_online'],
    seller_public_profiles: ['id'],
    products: ['id'],
  };
  const righeDi = (nome: string): Riga[] => {
    if (nome === 'orders') return stato.ordini;
    if (nome === 'cod_checkout_attempts') return stato.tentativi;
    if (nome === 'profiles') return stato.profili;
    if (nome === 'seller_public_profiles') return negozi;
    if (nome === 'products') return prodotti;
    return [];
  };
  const tavola = (nome: string) => {
    const filtri: Array<(r: Riga) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let valori: Riga = {};
    let soloConteggio = false;
    const tieni = (c: string, f: (r: Riga) => boolean) => {
      if ((colonne[nome] ?? []).includes(c)) filtri.push(f);
    };
    const b: Record<string, unknown> = {};
    for (const m of ['order', 'limit', 'is', 'gt', 'lt', 'lte', 'filter', 'not', 'or', 'upsert', 'neq']) b[m] = () => b;
    b.select = (_c?: string, o?: { count?: string; head?: boolean }) => {
      if (o?.head) soloConteggio = true;
      return b;
    };
    b.eq = (c: string, v: unknown) => (tieni(c, (r) => r[c] === v), b);
    b.in = (c: string, v: unknown[]) => (tieni(c, (r) => v.includes(r[c])), b);
    b.gte = (c: string, v: unknown) => (tieni(c, (r) => String(r[c]) >= String(v)), b);
    b.insert = (v: Riga | Riga[]) => ((op = 'insert'), (valori = Array.isArray(v) ? v[0] : v), b);
    b.update = (v: Riga) => ((op = 'update'), (valori = v), b);
    b.delete = () => ((op = 'delete'), b);
    const scelte = () => righeDi(nome).filter((r) => filtri.every((f) => f(r)));
    const esegui = (): { data: unknown; error: unknown; count?: number } => {
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
      if (soloConteggio) return { data: null, count: scelte().length, error: null };
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

async function ordinaLaVeloce(chiave: string) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO, items: [{ productId: PANE, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      deliverySlot: ETICHETTA_ADESSO,
      useCredit: false,
    }),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  const corpo = (await res.json()) as Riga;
  return { res, corpo };
}

const fattorino = (id: string): Riga => ({ id, role: 'rider', is_approved: true, rider_is_online: true });
/** Una veloce già venduta, in mano al fattorino: fascia «Adesso», in strada. */
const velocesInMano = (id: string): Riga => ({
  id, user_id: 'altro-cliente', seller_id: NEGOZIO, delivery_slot: ETICHETTA_ADESSO, delivery_status: 'OUT_FOR_DELIVERY', payment_method: 'cod',
});
const nuoveVeloci = () => stato.ordini.filter((o) => o.user_id === 'cliente-1');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T10:00:00Z')); // le 11 a Piacenza, dentro le 8-21
  stato.ordini.length = 0;
  stato.tentativi.length = 0;
  stato.profili.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R04-021 · la decisione: una veloce alla volta per fattorino disponibile', () => {
  const MEZZOGIORNO = new Date(2026, 10, 19, 12, 0);
  const NEGOZI = [{ nome: 'Pane Quotidiano', orari: null }];
  it('un fattorino con una veloce già in mano: la seconda non si vende', () => {
    const esito = veloceSiPuo({ adesso: MEZZOGIORNO, negozi: NEGOZI, fattoriniOnline: 1, velociInCorso: 1 });
    expect(esito.possibile, 'con un fattorino solo e una veloce in mano se ne vende un’altra').toBe(false);
  });
  it('due fattorini e una veloce in mano: la seconda si vende', () => {
    expect(veloceSiPuo({ adesso: MEZZOGIORNO, negozi: NEGOZI, fattoriniOnline: 2, velociInCorso: 1 }).possibile).toBe(true);
  });
  it('un fattorino libero: la veloce si vende', () => {
    expect(veloceSiPuo({ adesso: MEZZOGIORNO, negozi: NEGOZI, fattoriniOnline: 1, velociInCorso: 0 }).possibile).toBe(true);
  });
});

describe('R04-021 · la rotta dei contanti conta le veloci che i fattorini hanno in mano', () => {
  it('un fattorino acceso con una veloce già in mano: la seconda veloce è rifiutata con un 409', async () => {
    stato.profili.push(fattorino('rider-1'));
    stato.ordini.push(velocesInMano('ord-in-strada'));
    const { res, corpo } = await ordinaLaVeloce('veloce-1');
    expect(res.status, `la seconda veloce col fattorino occupato si vende: ${JSON.stringify(corpo)}`).toBe(409);
    expect(JSON.stringify(corpo)).toContain('hanno già in mano');
    expect(nuoveVeloci(), 'nessun ordine deve nascere').toHaveLength(0);
  });

  it('due fattorini accesi, una veloce in mano: la seconda veloce si vende', async () => {
    stato.profili.push(fattorino('rider-1'), fattorino('rider-2'));
    stato.ordini.push(velocesInMano('ord-in-strada'));
    const { res, corpo } = await ordinaLaVeloce('veloce-2');
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(nuoveVeloci()).toHaveLength(1);
  });

  it('un fattorino libero: la veloce si vende, e quella dopo no', async () => {
    stato.profili.push(fattorino('rider-1'));
    const primo = await ordinaLaVeloce('veloce-3');
    expect(primo.res.status, JSON.stringify(primo.corpo)).toBe(200);
    const nata = stato.ordini.find((o) => o.user_id === 'cliente-1');
    expect(nata?.delivery_slot, 'l ordine nato deve essere una veloce').toBe(ETICHETTA_ADESSO);
    const secondo = await ordinaLaVeloce('veloce-4');
    expect(secondo.res.status, `con l unico fattorino già impegnato si vende un’altra veloce: ${JSON.stringify(secondo.corpo)}`).toBe(409);
  });
});
