import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R052) — SU UNA CONTESTAZIONE PARZIALE SI TOGLIEVA AL NEGOZIO
 * L'INTERO NETTO DELL'ORDINE.
 *
 * Quando arriva un chargeback, la banca preleva da noi l'importo contestato —
 * che può essere una PARTE del pagamento, non tutto. Il codice però chiamava il
 * recupero dal negozio senza dirgli quanto: senza importo, quella funzione si
 * prende tutto il residuo.
 *
 * Su una contestazione da 20 € di un ordine da 50 € toglievamo al negozio i 45 €
 * di netto invece di 18: dal suo conto Stripe spariva più di quanto era stato
 * tolto a noi, e il conto tornava solo se poi la contestazione si vinceva. Su
 * un negozio piccolo, una sorpresa così sull'estratto conto è il tipo di cosa
 * per cui uno se ne va.
 *
 * L'importo contestato Stripe ce lo dice: era già nel testo dell'avviso agli
 * amministratori, ma nel calcolo non entrava mai.
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

const state: { ordini: Ordine[]; stornati: Array<{ id: string; importo: number | undefined }> } = {
  ordini: [],
  stornati: [],
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: async (o: { id: string }, importo?: number) => {
    state.stornati.push({ id: o.id, importo });
    return { reversalId: 'trr_1', reversedCents: importo ?? 0 };
  },
  reverseRiderTransfer: async () => ({ reversalId: null, reversedCents: 0 }),
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
});

describe('quando la banca contesta solo una parte del pagamento', () => {
  it('al negozio si toglie la sua quota di quella parte, non tutto il netto', async () => {
    state.ordini = [ordineDaCinquanta()];

    // Contestati 20 € su 50: al negozio spettano 45, quindi 18 tornano indietro.
    await handleDisputeCreated(contestazioneDa(2000));

    expect(state.stornati.length).toBe(1);
    expect(
      state.stornati[0].importo,
      'gli si toglie piu di quanto la banca ha tolto a noi: se la contestazione si perde non torna piu indietro',
    ).toBe(1800);
  });

  it('su una contestazione piena si continua a recuperare tutto', async () => {
    state.ordini = [ordineDaCinquanta()];

    await handleDisputeCreated(contestazioneDa(5000));

    // Tutto il residuo: e' il caso di sempre, e non deve cambiare.
    expect(state.stornati[0].importo === undefined || state.stornati[0].importo === 4500).toBe(true);
  });

  it('se il totale dell ordine non si sa, si comporta come prima', async () => {
    // Ordini nati prima della migrazione 124: senza il lordo non si puo'
    // calcolare nessuna proporzione, e indovinare sui soldi non si fa.
    state.ordini = [ordineDaCinquanta({ gross_total_cents: null, total_price: null })];

    await handleDisputeCreated(contestazioneDa(2000));

    expect(state.stornati[0].importo).toBeUndefined();
  });

  it('un bonifico non ancora partito non si tocca', async () => {
    state.ordini = [ordineDaCinquanta({ payout_status: 'HELD', stripe_transfer_id: null })];

    await handleDisputeCreated(contestazioneDa(2000));

    expect(state.stornati.length, 'non c e nessun bonifico da riprendere').toBe(0);
  });
});
