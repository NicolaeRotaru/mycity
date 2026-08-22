import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 22/8/2026 — DUE DIFETTI SULLA CONTESTAZIONE, TUTTI E DUE SUI SOLDI VERI.
 *
 * ① CONTESTAZIONE PERSA SU UN ORDINE GIA' CONSEGNATO.
 * Il codice scriveva «annullato» su tutti gli ordini della contestazione e
 * rimetteva a scaffale la merce di tutti. Ma la contestazione arriva quasi
 * sempre settimane DOPO la consegna: il caso escluso ovunque altrove era qui
 * il caso normale. Due danni insieme: la giacenza saliva su merce fisicamente
 * uscita dal negozio — prodotti fantasma in vendita, cioe' un secondo cliente
 * che compra una cosa che non c'e' — e consegne vere sparivano dal conteggio
 * delle consegne, che e' il numero su cui si giudica il progetto.
 *
 * ② CONTESTAZIONE VINTA: LO STORNO ACCUMULATO VENIVA AZZERATO.
 * `seller_payout_reversed_cents` e' un totale cumulato: dentro ci puo' essere
 * anche uno storno che con la contestazione non c'entra — un reso parziale
 * rimborsato prima, in cui il negozio aveva gia' restituito la sua quota.
 * Azzerandolo, il giro dei bonifici versava di nuovo tutto: il negozio
 * incassava due volte la stessa parte e la differenza la metteva MyCity.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const state: {
  esito: 'won' | 'lost';
  ordini: Array<Record<string, unknown>>;
  aggiornamenti: Array<{ payload: Record<string, unknown>; ids: string[] | null; id: string | null }>;
  stockRipristinato: string[];
} = { esito: 'lost', ordini: [], aggiornamenti: [], stockRipristinato: [] };

function event() {
  return {
    id: `evt_${state.esito}`,
    type: 'charge.dispute.closed',
    data: { object: { id: 'dp_1', status: state.esito, payment_intent: 'pi_1', charge: 'ch_1' } },
  };
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => event() } }),
  computeApplicationFeeCents: () => 0,
  computeSellerPayoutCents: () => 0,
  computeOrderSplit: () => ({ subtotalCents: 0, applicationFeeCents: 0, sellerPayoutCents: 0 }),
  isStripeConfigured: () => true,
}));
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: vi.fn(async () => ({ reversalId: null, reversedCents: 0 })),
  reverseRiderTransfer: vi.fn(async () => ({ reversalId: null, reversedCents: 0 })),
  applyConnectAccountStatus: vi.fn(),
  refundOrder: vi.fn(),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({})) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    rpc: (nome: string, args: Record<string, unknown>) => {
      if (nome === 'restore_stock_for_order') state.stockRipristinato.push(args.p_order_id as string);
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      if (table === 'stripe_event_log') {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { processed: false } }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: state.ordini, error: null }) }),
          update: (payload: Record<string, unknown>) => ({
            in: (_col: string, ids: string[]) => {
              state.aggiornamenti.push({ payload, ids, id: null });
              return Promise.resolve({ error: null });
            },
            eq: (_col: string, id: string) => {
              state.aggiornamenti.push({ payload, ids: null, id });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'profiles') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'admin1' }], error: null }) }) };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    },
  })),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function makeReq(): never {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
    body: '{}',
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.aggiornamenti = [];
  state.stockRipristinato = [];
});

describe('contestazione persa su un ordine gia consegnato', () => {
  beforeEach(() => {
    state.esito = 'lost';
    state.ordini = [
      { id: 'consegnato', delivery_status: 'DELIVERED', payout_status: 'TRANSFERRED' },
      { id: 'in-corso', delivery_status: 'OUT_FOR_DELIVERY', payout_status: 'HELD' },
    ];
  });

  it('non rimette a scaffale la merce di un ordine gia consegnato', async () => {
    await POST(makeReq());
    expect(state.stockRipristinato).not.toContain('consegnato');
    // Sull'ordine che il cliente non ha ancora ricevuto la merce torna, ed e' giusto.
    expect(state.stockRipristinato).toContain('in-corso');
  });

  it('non riscrive «annullato» su una consegna avvenuta', async () => {
    await POST(makeReq());
    const suiConsegnati = state.aggiornamenti.filter((a) => a.ids?.includes('consegnato'));
    expect(suiConsegnati.length).toBeGreaterThan(0);
    for (const a of suiConsegnati) {
      expect(a.payload.delivery_status).toBeUndefined();
      expect(a.payload.dispute_status).toBe('LOST');
      expect(a.payload.payment_status).toBe('REFUNDED');
    }
  });

  it('annulla invece l ordine che non era ancora arrivato', async () => {
    await POST(makeReq());
    const suiNonConsegnati = state.aggiornamenti.find((a) => a.ids?.includes('in-corso'));
    expect(suiNonConsegnati!.payload.delivery_status).toBe('CANCELED');
  });
});

describe('contestazione vinta', () => {
  beforeEach(() => {
    state.esito = 'won';
  });

  it('non azzera uno storno che veniva da un reso, ma toglie solo quello della contestazione', async () => {
    state.ordini = [{
      id: 'o1',
      delivery_status: 'DELIVERED',
      payout_status: 'REVERSED',
      payout_tentativo: 0,
      // 45 euro tornati indietro in tutto: 15 per un reso di prima, 30 per la contestazione.
      seller_payout_reversed_cents: 4500,
      dispute_seller_reversed_cents: 3000,
      rider_id: null,
      rider_payout_status: null,
    }];
    await POST(makeReq());

    const venditore = state.aggiornamenti.find((a) => a.payload.payout_status === 'HELD');
    expect(venditore, 'il venditore non e stato rimesso in coda').toBeDefined();
    // Col codice vecchio qui c'era 0, e i 15 euro del reso il negozio se li
    // faceva ripagare.
    expect(venditore!.payload.seller_payout_reversed_cents).toBe(1500);
    expect(venditore!.payload.dispute_seller_reversed_cents).toBe(0);
  });

  it('senza il promemoria della contestazione si comporta come prima, non peggio', async () => {
    state.ordini = [{
      id: 'o2',
      delivery_status: 'DELIVERED',
      payout_status: 'REVERSED',
      payout_tentativo: 0,
      seller_payout_reversed_cents: 4500,
      rider_id: null,
      rider_payout_status: null,
    }];
    await POST(makeReq());
    const venditore = state.aggiornamenti.find((a) => a.payload.payout_status === 'HELD');
    expect(venditore!.payload.seller_payout_reversed_cents).toBe(0);
  });
});
