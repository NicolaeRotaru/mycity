import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CHI CORREGGE IL NUMERO DI TELEFONO IN CASSA DEVE VEDERLO SULL'ORDINE.
 *
 * Maria scrive 333 111 1111, tocca Paga, e sulla pagina del pagamento si
 * accorge del numero sbagliato. Torna indietro, corregge in 333 999 9999 e
 * paga. La cassa riconosce «stesso carrello» e le restituisce il pagamento
 * gia' aperto invece di aprirne un secondo — giusto, altrimenti la merce
 * resterebbe impegnata due volte e il codice sconto verrebbe bruciato.
 *
 * Il difetto: l'ordine lo scrive il webhook leggendo la riga di intento, e
 * quella riga aveva ancora il numero di prima. Il fattorino chiamava un numero
 * che non risponde, su un ordine gia' pagato. Stessa storia per il nome e per
 * le note («lasciare al portiere, scala B»).
 *
 * Qui si prova che al riuso i tre campi di contatto vengono riscritti, e che
 * tutto il resto della riga — impronta del carrello, indirizzo, coordinate,
 * fascia oraria — resta intatto.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = '22222222-2222-2222-2222-222222222222';

/** Com'era la riga di intento del primo tentativo: numero e note sbagliati. */
const DELIVERY_VECCHIA = {
  full_name: 'Maria',
  address: 'Via Verdi 10',
  city: 'Piacenza',
  zip: '29121',
  phone: '3331111111',
  notes: null,
  lat: 45.05,
  lng: 9.7,
  slot: 'Stasera · 18:00–20:00',
  impronta_carrello: 'impronta-del-primo-tentativo',
};

const state: {
  user: { id: string; email: string | null; email_confirmed_at: string | null };
  profile: { id: string; role: string; is_approved: boolean };
  tentativoAperto: Record<string, unknown> | null;
  statoSessione: string;
} = {
  user: { id: 'buyer-1', email: 'b@x.com', email_confirmed_at: '2020-01-01T00:00:00Z' },
  profile: { id: 'buyer-1', role: 'buyer', is_approved: true },
  tentativoAperto: null,
  statoSessione: 'open',
};

const createSession = vi.fn(async () => ({ id: 'cs_nuova', url: 'https://stripe.test/cs_nuova' }));
const aggiornaIntento = vi.fn(async (_patch: unknown) => ({ error: null as { message: string } | null }));

vi.mock('@/lib/api/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/middleware')>();
  return {
    ...actual,
    withAuthRateLimit:
      (_opts: unknown, handler: (ctx: { user: typeof state.user; profile: typeof state.profile; req: Request }) => unknown) =>
      (req: Request) =>
        handler({ user: state.user, profile: state.profile, req }),
  };
});

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: () => createSession(),
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, status: state.statoSessione, url: `https://stripe.test/${id}` }),
      },
    },
  }),
}));

vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'no' })) }));
vi.mock('@/lib/shipping', () => ({
  shippingCentsFor: vi.fn(() => 0),
  compensoRiderCents: vi.fn(() => 250),
}));

vi.mock('@/lib/supabase/server', () => {
  const serverFrom = vi.fn((table: string) => {
    if (table === 'products') {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: P1, name: 'Pane', price: 10, images: [], seller_id: S1, stock: 50, status: 'available' }],
            error: null,
          }),
        }),
      };
    }
    return {
      select: () => ({
        in: () => Promise.resolve({
          data: [{ id: S1, store_name: 'Pane Quotidiano', store_lat: 45, store_lng: 9, store_hours: null }],
          error: null,
        }),
      }),
    };
  });
  const adminFrom = vi.fn((table: string) => {
    if (table === 'pending_checkouts') {
      return {
        select: () => {
          const b: Record<string, unknown> = {
            eq: () => b, gt: () => b, filter: () => b, order: () => b, limit: () => b,
            maybeSingle: () => Promise.resolve({ data: state.tentativoAperto, error: null }),
          };
          return b;
        },
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: { id: 'pc_2', expires_at: new Date(Date.now() + 2 * 3600_000).toISOString() },
              error: null,
            }),
          }),
        }),
        update: (patch: unknown) => ({ eq: () => aggiornaIntento(patch) }),
      };
    }
    if (table === 'user_addresses') {
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  });
  const rpc = vi.fn(() => Promise.resolve({ data: true, error: null }));
  return {
    getServerSupabase: vi.fn(() => ({ from: serverFrom, rpc })),
    getAdminSupabase: vi.fn(() => ({ from: adminFrom, rpc })),
  };
});

import { POST } from '@/app/api/stripe/checkout/route';

function richiesta(delivery: Record<string, unknown>) {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 }],
      delivery,
      pickupInStore: false,
      deliverySlot: 'Stasera · 18:00–20:00',
    }),
  }) as never;
}

/** I dati che Maria manda al secondo tentativo: numero e note corretti. */
const CONTATTO_CORRETTO = {
  fullName: 'Maria Rossi',
  address: 'Via Verdi 10',
  city: 'Piacenza',
  zip: '29121',
  phone: '3339999999',
  notes: 'lasciare al portiere, scala B',
};

/** Quello che l'ultima scrittura ha messo nel campo `delivery`. */
function ultimaDelivery(): Record<string, unknown> {
  const patch = aggiornaIntento.mock.calls[aggiornaIntento.mock.calls.length - 1][0] as { delivery: Record<string, unknown> };
  return patch.delivery;
}

describe('il pagamento gia aperto si riusa, ma col contatto di adesso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.statoSessione = 'open';
    state.tentativoAperto = {
      id: 'pc_1',
      stripe_session_id: 'cs_vecchia',
      delivery: { ...DELIVERY_VECCHIA },
    };
  });

  it('il numero corretto finisce sulla riga che il webhook leggera per fare l ordine', async () => {
    const res = await POST(richiesta(CONTATTO_CORRETTO));

    expect(res.status).toBe(200);
    // Nessun secondo pagamento aperto: la difesa dal doppio invio resta intera.
    expect(createSession).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ data: { id: 'cs_vecchia' } });

    // E il contatto sulla riga di intento e' quello appena scritto.
    expect(aggiornaIntento).toHaveBeenCalledTimes(1);
    expect(ultimaDelivery()).toMatchObject({
      full_name: 'Maria Rossi',
      phone: '3339999999',
      notes: 'lasciare al portiere, scala B',
    });
  });

  it('il resto della riga non si perde: impronta, indirizzo, coordinate e fascia restano', async () => {
    await POST(richiesta(CONTATTO_CORRETTO));
    expect(ultimaDelivery()).toMatchObject({
      impronta_carrello: 'impronta-del-primo-tentativo',
      address: 'Via Verdi 10',
      city: 'Piacenza',
      zip: '29121',
      lat: 45.05,
      lng: 9.7,
      slot: 'Stasera · 18:00–20:00',
    });
  });

  it('se non e cambiato niente non si scrive niente: il doppio invio resta un no-op', async () => {
    const res = await POST(
      richiesta({
        fullName: DELIVERY_VECCHIA.full_name,
        address: DELIVERY_VECCHIA.address,
        city: DELIVERY_VECCHIA.city,
        zip: DELIVERY_VECCHIA.zip,
        phone: DELIVERY_VECCHIA.phone,
      }),
    );
    expect(res.status).toBe(200);
    expect(aggiornaIntento).not.toHaveBeenCalled();
  });

  it('se la sessione vecchia non e piu aperta se ne fa una nuova, coi dati di adesso', async () => {
    state.statoSessione = 'expired';
    const res = await POST(richiesta(CONTATTO_CORRETTO));
    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
