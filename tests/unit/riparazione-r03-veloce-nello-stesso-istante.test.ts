import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * 21/11/2026 (R03-019) — DUE VELOCI NELLO STESSO ISTANTE CON UN FATTORINO SOLO.
 *
 * La regola: una veloce per fattorino disponibile. La rotta dei contanti la controllava PRIMA di
 * scrivere l'ordine, e controllo e scrittura non sono un passo solo: due invii insieme leggevano
 * tutti e due «c'è posto» e nascevano tutti e due. Adesso, a ordini scritti, la rotta riconta le
 * veloci in corso e annulla i suoi ordini se il posto non c'è più.
 *
 * Il tetto «quante veloci per fattorino» vive in lib/ordini/consegna-veloce.ts: qui la decisione
 * vera (`veloceSiPuo`) gira col tetto della regola, 1. Il database finto tiene gli ordini davvero e
 * risponde al conteggio come PostgREST (`count`, `head`).
 */

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
  negozi: [] as Riga[],
  fattorini: 1 as number | null,
}));

vi.mock('@/lib/ordini/consegna-veloce', async (originale) => {
  const vero = await originale<typeof import('@/lib/ordini/consegna-veloce')>();
  return {
    ...vero,
    contaFattoriniOnline: vi.fn(async () => stato.fattorini),
    // La regola registrata: una veloce per fattorino disponibile.
    veloceSiPuo: (s: Parameters<typeof vero.veloceSiPuo>[0]) => vero.veloceSiPuo({ ...s, velociPerFattorino: s.velociPerFattorino ?? 1 }),
  };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: Riga; profile: unknown; req: unknown }) => unknown) =>
    (req: Request) => {
      const chi = req.headers.get('x-cliente') ?? 'cliente-1';
      return h({
        user: { id: chi, email: `${chi}@test.it`, email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      });
    },
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
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessuno' })) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: vi.fn() }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => ({ lat: 45.0526, lng: 9.6929 })) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti: Riga[] = [
    { id: '11111111-1111-4111-8111-111111111111', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Pane', price: 15, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: true },
    { id: '22222222-2222-4222-8222-222222222222', seller_id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Fiori', price: 12, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: true },
  ];
  const colonne: Record<string, string[]> = {
    orders: ['id', 'user_id', 'payment_method', 'created_at', 'delivery_slot', 'delivery_status'],
    order_items: ['order_id'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    seller_public_profiles: ['id'],
    products: ['id'],
  };
  const righeDi = (nome: string): Riga[] => {
    if (nome === 'orders') return stato.ordini;
    if (nome === 'order_items') return stato.articoli;
    if (nome === 'cod_checkout_attempts') return stato.tentativi;
    if (nome === 'seller_public_profiles') return stato.negozi;
    if (nome === 'products') return prodotti;
    return [];
  };
  const tavola = (nome: string) => {
    const filtri: Array<(r: Riga) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let valori: Riga | Riga[] = {};
    let conta = false;
    const tieni = (c: string, f: (r: Riga) => boolean) => {
      if ((colonne[nome] ?? []).includes(c)) filtri.push(f);
    };
    const b: Record<string, unknown> = {};
    for (const m of ['order', 'limit', 'gt', 'lt', 'lte', 'filter', 'not', 'or', 'upsert', 'neq']) b[m] = () => b;
    b.select = (_c?: string, o?: { count?: string }) => ((conta = conta || Boolean(o?.count)), b);
    b.eq = (c: string, v: unknown) => (tieni(c, (r) => r[c] === v), b);
    b.is = (c: string, v: unknown) => (tieni(c, (r) => (r[c] ?? null) === v), b);
    b.in = (c: string, v: unknown[]) => (tieni(c, (r) => v.includes(r[c])), b);
    b.gte = (c: string, v: unknown) => (tieni(c, (r) => String(r[c]) >= String(v)), b);
    b.insert = (v: Riga | Riga[]) => ((op = 'insert'), (valori = v), b);
    b.update = (v: Riga) => ((op = 'update'), (valori = v), b);
    b.delete = () => ((op = 'delete'), b);
    const scelte = () => righeDi(nome).filter((x) => filtri.every((f) => f(x)));
    const esegui = (): { data: unknown; error: unknown; count?: number } => {
      if (op === 'insert') {
        const uno = (Array.isArray(valori) ? valori[0] : valori) as Riga;
        if (nome === 'orders') {
          const id = (uno.id as string | undefined) ?? `ord-${stato.ordini.length + 1}`;
          if (stato.ordini.some((o) => o.id === id)) return { data: null, error: { code: '23505', message: 'duplicate key orders_pkey' } };
          stato.ordini.push({ ...uno, id, created_at: new Date().toISOString() });
          return { data: { id }, error: null };
        }
        if (nome === 'order_items') {
          stato.articoli.push(...(Array.isArray(valori) ? valori : [valori]));
          return { data: null, error: null };
        }
        if (nome === 'cod_checkout_attempts') {
          if (stato.tentativi.some((t) => t.chiave === uno.chiave)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          stato.tentativi.push({ ...uno, created_at: new Date().toISOString() });
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
      if (conta) return { data: null, error: null, count: scelte().length };
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
  const rpc = () => Promise.resolve({ data: null, error: null });
  return {
    getAdminSupabase: () => ({
      from: tavola,
      rpc,
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from: tavola }),
  };
});

async function veloce(chi: string, chiave: string, gruppi: unknown[]) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': chiave, 'x-cliente': chi },
    body: JSON.stringify({
      groups: gruppi,
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      deliverySlot: ETICHETTA_ADESSO,
      useCredit: false,
    }),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  return { status: res.status, corpo: (await res.json()) as Riga };
}

const AL_FORNO = { sellerId: FORNO, items: [{ productId: PANE, quantity: 1 }] };
const AL_FIORAIO = { sellerId: FIORAIO, items: [{ productId: FIORI, quantity: 1 }] };
const velociVive = () => stato.ordini.filter((o) => o.delivery_slot === ETICHETTA_ADESSO);

beforeEach(() => {
  // Giovedì 19/11/2026 alle 10 di Roma: la veloce si fa (8-21).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T09:00:00Z'));
  stato.ordini.length = 0;
  stato.articoli.length = 0;
  stato.tentativi.length = 0;
  stato.fattorini = 1;
  stato.negozi.length = 0;
  stato.negozi.push(
    { id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
    { id: FIORAIO, store_name: 'Fiori di Via Roma', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
  );
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-019 · due veloci nello stesso istante con un fattorino solo', () => {
  it('due clienti insieme, un fattorino: non passano tutte e due', async () => {
    const [a, b] = await Promise.all([
      veloce('cliente-a', 'veloce-a', [AL_FORNO]),
      veloce('cliente-b', 'veloce-b', [AL_FIORAIO]),
    ]);
    const passate = [a, b].filter((r) => r.status === 200);
    expect(passate.length, `con un fattorino solo sono passate due veloci: ${JSON.stringify([a, b])}`).toBeLessThanOrEqual(1);
    expect(velociVive().length, 'restano due veloci vive per un fattorino solo').toBeLessThanOrEqual(1);
    for (const r of [a, b].filter((x) => x.status !== 200)) {
      expect(r.status, JSON.stringify(r.corpo)).toBe(409);
      expect(JSON.stringify(r.corpo)).toMatch(/fattorini/);
    }
    // Chi è stato fermato non lascia articoli in giro.
    const vivi = new Set(stato.ordini.map((o) => o.id));
    expect(stato.articoli.every((r) => vivi.has(r.order_id))).toBe(true);
  });

  it('una veloce già in mano all unico fattorino: la seconda non nasce', async () => {
    stato.ordini.push({ id: 'ord-in-strada', user_id: 'altro', delivery_slot: ETICHETTA_ADESSO, delivery_status: 'OUT_FOR_DELIVERY' });
    const r = await veloce('cliente-a', 'veloce-dopo', [AL_FORNO]);
    expect(r.status, `la seconda veloce è passata con il fattorino occupato: ${JSON.stringify(r.corpo)}`).toBe(409);
    expect(velociVive().map((o) => o.id)).toEqual(['ord-in-strada']);
  });

  it('due fattorini: le due veloci insieme passano tutte e due', async () => {
    stato.fattorini = 2;
    const [a, b] = await Promise.all([
      veloce('cliente-a', 'veloce-a2', [AL_FORNO]),
      veloce('cliente-b', 'veloce-b2', [AL_FIORAIO]),
    ]);
    expect([a.status, b.status], JSON.stringify([a.corpo, b.corpo])).toEqual([200, 200]);
    expect(velociVive()).toHaveLength(2);
  });

  it('una veloce sola, un fattorino libero: passa come prima', async () => {
    const r = await veloce('cliente-a', 'veloce-sola', [AL_FORNO]);
    expect(r.status, JSON.stringify(r.corpo)).toBe(200);
    expect(velociVive()).toHaveLength(1);
  });
});
