import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 29/10/2026 — LE DUE ROTTE, CHIAMATE DAVVERO CON LA FASCIA «ADESSO».
 *
 * Il collaudo dell'ondata 13 aveva visto verdi tre mutanti sui soldi: una rotta che passa
 * «consegnaVeloce: false» al conto (un ordine veloce da 15 € pagherebbe 3 €), una lettura dei
 * fattorini che cade e diventa «sì» (`contaFattoriniOnline(admin) ?? 1`). La prova di allora
 * cercava una parola nel sorgente. Qui la rotta in contanti e quella con carta ricevono un
 * carrello vero e si guardano i centesimi che scrivono sull'ordine o mandano al pagamento.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const S1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const S2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const stato: { fattorini: number | null; inseriti: Array<Record<string, unknown>> } = { fattorini: 1, inseriti: [] };
const createSession = vi.fn(async (_i: unknown) => ({ id: 'cs_test', url: 'https://stripe.test/cs_test' }));

// 31/10/2026 — Al lancio la carta è spenta (CARTA_ACCESA in lib/funzioni-al-lancio.ts) e la rotta
// la rifiuta anche con le chiavi. Questa prova misura il percorso della carta: la accende per finta.
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  CARTA_ACCESA: true,
}));
vi.mock('@/lib/ordini/consegna-veloce', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/ordini/consegna-veloce')>();
  return { ...vero, contaFattoriniOnline: vi.fn(async () => stato.fattorini) };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/api/middleware')>();
  return {
    ...vero,
    withAuthRateLimit: (_o: unknown, h: (c: Record<string, unknown>) => unknown) => (req: Request) =>
      h({
        user: { id: 'cliente-1', email: 'c@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { id: 'cliente-1', role: 'buyer', is_approved: true },
        req,
      }),
    assertCanPurchase: vi.fn(() => null),
  };
});
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessuno' })) }));
vi.mock('@/lib/shipping-coordinate', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/shipping-coordinate')>();
  return { ...vero, coordinateDaIndirizziSalvati: vi.fn(async () => null) };
});
vi.mock('@/lib/geocodifica', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/geocodifica')>();
  return { ...vero, coordinateDiUnIndirizzo: vi.fn(async () => null) };
});
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => true),
}));
vi.mock('@/lib/stripe/client', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/stripe/client')>();
  return {
    ...vero,
    isStripeConfigured: () => true,
    createMultiSellerCheckoutSession: (i: unknown) => createSession(i),
  };
});

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: P1, seller_id: S1, name: 'Pane', price: 15, stock: 10, has_variants: false, images: ['a.jpg'], status: 'available' },
    { id: P2, seller_id: S2, name: 'Frutta', price: 12, stock: 10, has_variants: false, images: ['b.jpg'], status: 'available' },
  ];
  const venditori = [
    { id: S1, store_name: 'Forno', full_name: null, store_lat: null, store_lng: null, store_hours: null, email: 'a@b.it', role: 'seller', is_approved: true },
    { id: S2, store_name: 'Frutta', full_name: null, store_lat: null, store_lng: null, store_hours: null, email: 'c@d.it', role: 'seller', is_approved: true },
  ];
  const catena = (valore: unknown): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'in', 'gt', 'filter', 'order', 'limit', 'update', 'delete', 'neq', 'is']) b[k] = () => b;
    b.single = () => Promise.resolve(valore);
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(valore).then(ok, ko);
    b.insert = (v: unknown) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && 'delivery_fee_cents' in (v as object)) {
        stato.inseriti.push(v as Record<string, unknown>);
        return catena({ data: { id: `ord-${stato.inseriti.length}` }, error: null });
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && 'expires_at' in (v as object) === false && 'chiave' in (v as object) === false) {
        return catena({ data: { id: 'pc_1', expires_at: new Date(Date.now() + 2 * 3600_000).toISOString() }, error: null });
      }
      return catena({ data: { id: 'x', expires_at: new Date(Date.now() + 2 * 3600_000).toISOString() }, error: null });
    };
    return b;
  };
  const from = (t: string) => {
    const filtroNegozi = (ids?: string[]) => ({ data: ids ? venditori.filter((v) => ids.includes(v.id)) : venditori, error: null });
    if (t === 'products') {
      const c = catena({ data: prodotti, error: null });
      c.in = (_c: string, ids: string[]) => catena({ data: prodotti.filter((p) => ids.includes(p.id)), error: null });
      return c;
    }
    if (t === 'profiles' || t === 'seller_public_profiles') {
      const c = catena(filtroNegozi());
      c.in = (_c: string, ids: string[]) => catena(filtroNegozi(ids));
      return c;
    }
    return catena({ data: [], error: null });
  };
  const rpc = vi.fn(() => Promise.resolve({ data: 0, error: null }));
  const db = { from, rpc, auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@t.it` } } }) } } };
  return { getAdminSupabase: () => db, getServerSupabase: async () => ({ ...db, auth: { getUser: async () => ({ data: { user: { id: 'cliente-1' } } }) } }) };
});

import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

function corpo(merci: Array<[string, string]>, deliverySlot: string) {
  return JSON.stringify({
    groups: merci.map(([sellerId, productId]) => ({ sellerId, items: [{ productId, quantity: 1 }], shippingCents: 0 })),
    delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
    pickupInStore: false,
    useCredit: false,
    couponDiscountCents: 0,
    pickupDiscountCents: 0,
    deliverySlot,
  });
}
async function contanti(merci: Array<[string, string]>, fascia: string, chiave: string) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
    body: corpo(merci, fascia),
  });
  return (POST as unknown as (r: Request) => Promise<Response>)(req);
}
async function carta(merci: Array<[string, string]>, fascia: string) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const req = new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: corpo(merci, fascia),
  });
  return (POST as unknown as (r: Request) => Promise<Response>)(req);
}
const consegneInviate = () =>
  (createSession.mock.calls.at(-1)?.[0] as { deliveryFeePerGroupCents: number[] } | undefined)?.deliveryFeePerGroupCents;

let n = 0;
describe('le rotte fanno pagare la veloce, in centesimi', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T09:00:00Z')); // le 10 a Piacenza
    stato.fattorini = 1;
    stato.inseriti = [];
    createSession.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('contanti, un negozio da 15 € con «Adesso»: 4 € di consegna sull’ordine', async () => {
    const r = await contanti([[S1, P1]], ETICHETTA_ADESSO, `k-${++n}`);
    expect(r.status, JSON.stringify(await r.clone().json())).toBeLessThan(300);
    expect(stato.inseriti.map((o) => o.delivery_fee_cents)).toEqual([400]);
  });

  it('contanti, 15 € + 12 € con «Adesso»: 5 € in tutto, il primo negozio porta base e veloce', async () => {
    const r = await contanti([[S1, P1], [S2, P2]], ETICHETTA_ADESSO, `k-${++n}`);
    expect(r.status, JSON.stringify(await r.clone().json())).toBeLessThan(300);
    expect(stato.inseriti.map((o) => o.delivery_fee_cents)).toEqual([400, 100]);
  });

  it('contanti: se la lettura dei fattorini cade, «Adesso» non passa', async () => {
    stato.fattorini = null;
    const r = await contanti([[S1, P1]], ETICHETTA_ADESSO, `k-${++n}`);
    expect(r.status).toBe(409);
    expect(stato.inseriti).toEqual([]);
  });

  it('carta, un negozio da 15 € con «Adesso»: 4 € di consegna al pagamento', async () => {
    const r = await carta([[S1, P1]], ETICHETTA_ADESSO);
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect(consegneInviate()).toEqual([400]);
  });

  it('carta, 15 € + 12 € con «Adesso»: 5 € in tutto', async () => {
    const r = await carta([[S1, P1], [S2, P2]], ETICHETTA_ADESSO);
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    expect(consegneInviate()).toEqual([400, 100]);
  });

  it('carta: se la lettura dei fattorini cade, il pagamento non si apre', async () => {
    stato.fattorini = null;
    const r = await carta([[S1, P1]], ETICHETTA_ADESSO);
    expect(r.status).toBe(409);
    expect(createSession).not.toHaveBeenCalled();
  });
});
