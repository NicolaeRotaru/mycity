import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO, FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * R31-025 (strada dei contanti) — La campanella «Nuovo ordine» del negozio diceva «Ordine #ABC123 ·
 * 24,50 € · pagamento alla consegna» e basta: per quando andava consegnato lo diceva solo l'email.
 * La push del telefono nasce da quella riga (app/api/cron/send-push legge `notifications`): sabato
 * alle 11:05 il fornaio non sapeva se l'ordine era per le 12:00 o per domani finché non apriva
 * l'ordine o l'email. Su una veloce da pochi minuti quel passaggio in più è il ritardo.
 *
 * Qui gira la rotta vera dei contanti, con autenticazione e database finti; si leggono le righe
 * scritte in `notifications`.
 */

const NEGOZIO_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const campanelle: Array<Record<string, unknown>> = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: unknown; profile: unknown; req: unknown }) => unknown) =>
    (req: unknown) =>
      h({
        user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/auth/accettazione-testi', async (o) => ({ ...((await o()) as object), vaChiestaSenzaTrattenere: async () => 'lascia-entrare' }));
vi.mock('@/lib/store-hours', async (o) => ({
  ...((await o()) as object),
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/ordini/consegna-veloce', async (o) => ({
  ...((await o()) as object),
  contaFattoriniOnline: vi.fn(async () => 3),
  // R04-021 — liberi: nessuna veloce già in mano (una alla volta per fattorino).
  contaVelociInCorso: vi.fn(async () => 0),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessun codice' })) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: () => undefined }));
vi.mock('@/lib/stripe/webhook/comune', async (o) => ({ ...((await o()) as object), notifyAdmins: vi.fn(async () => 'scritto') }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => ({ lat: 45.0526, lng: 9.7 })) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => ({ lat: 45.0526, lng: 9.7 })) }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: PRODOTTO, seller_id: NEGOZIO_ID, name: 'Pane', price: 12, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [{ id: NEGOZIO_ID, store_name: 'Pane Quotidiano', store_lat: 45.0526, store_lng: 9.6929, store_hours: null }];
  const catena = (lista: unknown, singolo: unknown = { data: null, error: null }) => {
    const b: Record<string, unknown> = {};
    for (const passo of ['select', 'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'filter', 'order', 'limit', 'not', 'or', 'update', 'upsert', 'delete', 'insert']) {
      b[passo] = () => b;
    }
    b.single = () => Promise.resolve(singolo);
    b.maybeSingle = () => Promise.resolve(singolo);
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(lista).then(ok, ko);
    return b;
  };
  const from = (tavola: string): Record<string, unknown> => {
    if (tavola === 'products') return catena({ data: prodotti, error: null });
    if (tavola === 'seller_public_profiles') return catena({ data: venditori, error: null });
    if (tavola === 'orders') {
      const c = catena({ data: [], error: null });
      c.insert = () => catena({ data: [{ id: 'ord-1' }], error: null }, { data: { id: 'ord-1' }, error: null });
      return c;
    }
    if (tavola === 'notifications') {
      const c = catena({ data: [], error: null });
      c.insert = (righe: unknown) => {
        campanelle.push(...((Array.isArray(righe) ? righe : [righe]) as Array<Record<string, unknown>>));
        return catena({ data: null, error: null });
      };
      return c;
    }
    return catena({ data: [], error: null });
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

function ordina(fascia: string | null): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO_ID, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      ...(fascia ? { deliverySlot: fascia } : {}),
      useCredit: false,
    }),
  }) as never;
}

async function paga(fascia: string | null) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(ordina(fascia));
  return res;
}

const alNegozio = () => campanelle.filter((c) => c.user_id === NEGOZIO_ID);

beforeEach(() => {
  // Martedì 17/11/2026 alle 11:05 di Piacenza: negozio aperto, la veloce si può.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T10:05:00Z'));
  campanelle.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('R31-025 · contanti: la campanella «Nuovo ordine» dice per quando va consegnato', () => {
  it('con la fascia di domani la campanella al negozio la scrive, come l’email', async () => {
    const res = await paga(FASCE_DI_DOMANI[0]);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(alNegozio(), 'nessuna campanella al negozio').toHaveLength(1);
    const corpo = String(alNegozio()[0].body);
    expect(corpo).toContain(`Consegna: ${FASCE_DI_DOMANI[0]}`);
    expect(corpo).toMatch(/^Ordine #\S+ · .+ · pagamento alla consegna/);
  });

  it('con la veloce la campanella dice che è da portare adesso', async () => {
    const res = await paga(ETICHETTA_ADESSO);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(alNegozio()).toHaveLength(1);
    expect(String(alNegozio()[0].body)).toContain(`Consegna: ${ETICHETTA_ADESSO}`);
  });
});
