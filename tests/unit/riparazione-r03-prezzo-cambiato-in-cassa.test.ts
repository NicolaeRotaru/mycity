import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-011 — Se il negozio alza un prezzo (o la promozione scade) mentre il cliente è in cassa,
 * l'ordine in contanti non nasce col prezzo nuovo senza che nessuno glielo dica.
 *
 * La cassa manda il sottototale di ogni negozio come l'ha mostrato. Se il server, coi prezzi di
 * adesso, trova un'altra cifra, risponde 409 PREZZI_CAMBIATI con le cifre nuove e non crea
 * l'ordine. Senza il campo (pagina vecchia) tutto resta come prima.
 *
 * Banco preso da la-cassa-non-dice-fatto-per-un-ordine-senza-articoli.test.ts: il pane costa 4 €.
 */

const FORNO = 'aaaaaaaa-0000-4000-8000-000000000001';
const PANE = '11111111-1111-4111-8111-111111111111';
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
  articoli: [] as Riga[],
  rpc: [] as string[],
  cancellaOrdiniFallisce: false,
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
    order_items: ['order_id'],
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
        if (nome === 'orders' && stato.cancellaOrdiniFallisce) return { data: null, error: { message: 'rete ancora giu' } };
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
      rpc: (n: string) => (stato.rpc.push(n), Promise.resolve({ data: null, error: null })),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from: tavola }),
  };
});

const AL_FORNO = { sellerId: FORNO, items: [{ productId: PANE, quantity: 1 }] };

async function ordina(extra: Riga = {}) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `r03-011-${Math.random()}` },
    body: JSON.stringify({
      groups: [AL_FORNO],
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
      ...extra,
    }),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  return { res, corpo: (await res.json()) as { ok?: boolean; error?: { code?: string; details?: { adesso?: number[] } } } };
}

beforeEach(() => {
  stato.ordini.length = 0;
  stato.tentativi.length = 0;
  stato.profili.length = 0;
  stato.negozi.length = 0;
  stato.negozi.push({ id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null });
  stato.vetrina = null;
  stato.articoli.length = 0;
  stato.rpc.length = 0;
});

describe('R03-011 — il prezzo cambiato in cassa ferma l ordine in contanti', () => {
  it('la cassa mostrava 3,00 €, adesso il pane costa 4,00 €: 409 con la cifra nuova e nessun ordine', async () => {
    const { res, corpo } = await ordina({ subtotaliVistiCents: [300] });
    expect(res.status, 'l ordine nasce al prezzo nuovo senza avviso').toBe(409);
    expect(corpo.error?.code).toBe('PREZZI_CAMBIATI');
    expect(corpo.error?.details?.adesso).toEqual([400]);
    expect(stato.ordini).toHaveLength(0);
  });

  it('stessa cifra mostrata e calcolata: l ordine nasce', async () => {
    const { res } = await ordina({ subtotaliVistiCents: [400] });
    expect(res.ok).toBe(true);
    expect(stato.ordini).toHaveLength(1);
  });

  it('senza il campo (pagina vecchia) l ordine nasce come prima', async () => {
    const { res } = await ordina();
    expect(res.ok).toBe(true);
  });
});
