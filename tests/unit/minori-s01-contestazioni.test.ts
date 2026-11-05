import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — 73: su una contestazione di una parte del pagamento, al fattorino si
 * riprende la stessa parte del compenso, non tutto (banco da una-contestazione-parziale-non-si-prende-tutto).
 */

type Ordine = {
  id: string;
  payout_status: string;
  stripe_transfer_id: string | null;
  seller_payout_cents: number;
  seller_payout_reversed_cents: number;
  gross_total_cents?: number | null;
  total_price?: number | null;
  rider_payout_status: string | null;
  rider_transfer_id: string | null;
};

const state: { ordini: Ordine[]; stornati: Array<{ id: string; importo: number | undefined }>; fattorino: Array<{ id: string; importo: number | undefined }> } = {
  ordini: [],
  stornati: [],
  fattorino: [],
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: async (o: { id: string }, importo?: number) => {
    state.stornati.push({ id: o.id, importo });
    return { reversalId: 'trr_1', reversedCents: importo ?? 0 };
  },
  reverseRiderTransfer: async (o: { id: string }, importo?: number) => {
    state.fattorino.push({ id: o.id, importo });
    return { reversalId: 'trr_r', reversedCents: importo ?? 300 };
  },
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  findOrdersForDispute: async () => state.ordini.map((o) => ({ ...o })),
  notifyAdmins: async () => {},
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
        in: () => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

import { handleDisputeCreated } from '@/lib/stripe/webhook/dispute';

function contestazioneDa(centesimi: number) {
  return {
    id: 'dp_1',
    amount: centesimi,
    charge: 'ch_1',
    payment_intent: 'pi_1',
  } as unknown as Parameters<typeof handleDisputeCreated>[0];
}

/** Ordine da 50 €, di cui 45 sono del negozio, bonifico già partito. */
function ordineDaCinquanta(extra: Partial<Ordine> = {}): Ordine {
  return {
    id: 'o1',
    payout_status: 'TRANSFERRED',
    stripe_transfer_id: 'tr_1',
    seller_payout_cents: 4500,
    seller_payout_reversed_cents: 0,
    gross_total_cents: 5000,
    total_price: 50,
    rider_payout_status: null,
    rider_transfer_id: null,
    ...extra,
  };
}

beforeEach(() => {
  state.stornati = [];
  state.fattorino = [];
});


describe('73 — il compenso del fattorino su una contestazione parziale', () => {
  it('20 € contestati su 50: al fattorino si riprendono 1,20 € dei suoi 3', async () => {
    state.ordini = [ordineDaCinquanta({ rider_payout_status: 'TRANSFERRED', rider_transfer_id: 'tr_r', ...({ rider_fee_cents: 300 } as object) })];
    await handleDisputeCreated(contestazioneDa(2000));
    expect(state.fattorino).toEqual([{ id: 'o1', importo: 120 }]);
  });
  it('contestazione piena: tutto il residuo, come prima', async () => {
    state.ordini = [ordineDaCinquanta({ rider_payout_status: 'TRANSFERRED', rider_transfer_id: 'tr_r', ...({ rider_fee_cents: 300 } as object) })];
    await handleDisputeCreated(contestazioneDa(5000));
    expect(state.fattorino[0].importo).toBeUndefined();
  });
});
