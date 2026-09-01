import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R050) — DUE BONIFICI DIVERSI CON LA STESSA CHIAVE.
 *
 * Ogni bonifico parte con una «chiave di idempotenza»: se la stessa chiave
 * torna, Stripe restituisce il bonifico di prima invece di farne un altro. È la
 * protezione contro il doppio pagamento, e serve.
 *
 * Ma la chiave era `payout_seller_<ordine>_t<tentativo>`, e l'importo non
 * c'era. L'importo invece cambia: è il residuo del netto del negozio, e cala
 * ogni volta che un rimborso parziale ne mette una parte a carico del negozio.
 * Quindi lo stesso ordine poteva ritentare il bonifico con la stessa chiave e
 * un importo diverso — e Stripe quella la rifiuta.
 *
 * Il caso vero: bonifico fallito una volta (il giro lo rimette in HELD),
 * rimborso parziale nel frattempo, e da lì in poi ogni giro del cron ritenta
 * con la chiave vecchia, Stripe risponde errore, l'ordine torna in HELD e
 * rimbalza all'infinito. Il negozio ha consegnato e non viene pagato mai.
 *
 * Adesso i centesimi stanno nella chiave: un ritentativo con lo STESSO importo
 * resta protetto esattamente come prima, e un importo diverso è una richiesta
 * diversa, che passa.
 */

type Riga = Record<string, unknown>;

const state: { ordine: Riga; profilo: Riga; bonificiEsistenti: Riga[] } = {
  ordine: {},
  profilo: {},
  // Quello che Stripe ha davvero in pancia per questo ordine.
  bonificiEsistenti: [],
};
const transfersCreate = vi.fn(async (_corpo: Riga, _opts: { idempotencyKey: string }) => ({ id: 'tr_1' }));
const transfersList = vi.fn(async () => ({ data: state.bonificiEsistenti }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ transfers: { create: transfersCreate, list: transfersList } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));

/** Scrittura che accetta qualunque catena di filtri e finisce sempre bene. */
function scrittura(valori: Riga) {
  const b: Record<string, unknown> = {
    eq: () => b,
    in: () => b,
    or: () => b,
    select: () => b,
    then: (risolvi: (x: unknown) => unknown) => {
      Object.assign(state.ordine, valori);
      return risolvi({ data: [{ id: state.ordine.id }], error: null });
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          // Una fotografia, come fa il database vero.
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { ...state.ordine }, error: null }) }) }),
          update: (valori: Riga) => scrittura(valori),
        };
      }
      if (tabella === 'profiles') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.profilo, error: null }) }) }) };
      }
      return {};
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

import { releaseOrderPayout, releaseRiderPayout } from '@/lib/stripe/payout';

beforeEach(() => {
  transfersCreate.mockClear();
  transfersList.mockClear();
  state.bonificiEsistenti = [];
  state.profilo = { stripe_account_id: 'acct_1', stripe_payouts_enabled: true };
});

describe('la chiave del bonifico al negozio', () => {
  function ordinePronto(extra: Riga = {}): Riga {
    return {
      id: 'o1',
      seller_id: 's1',
      payout_status: 'HELD',
      delivery_status: 'DELIVERED',
      seller_payout_cents: 5000,
      seller_payout_reversed_cents: 0,
      payout_tentativo: 0,
      stripe_charge_id: 'ch_1',
      stripe_transfer_group: 'order_o1',
      ...extra,
    };
  }

  it('due importi diversi sullo stesso ordine non chiedono la stessa cosa a Stripe', async () => {
    // Primo giro: il negozio deve prendere 50 €.
    state.ordine = ordinePronto();
    await releaseOrderPayout('o1');

    // Il bonifico e fallito (l ordine torna in HELD) e nel frattempo arriva un
    // rimborso parziale: 20 € finiscono a carico del negozio. Adesso gliene
    // spettano 30.
    state.ordine = ordinePronto({ seller_payout_reversed_cents: 2000 });
    await releaseOrderPayout('o1');

    expect(transfersCreate).toHaveBeenCalledTimes(2);
    const [primo, secondo] = transfersCreate.mock.calls;
    expect(primo[0].amount).toBe(5000);
    expect(secondo[0].amount).toBe(3000);
    expect(
      secondo[1].idempotencyKey,
      'stessa chiave con un importo diverso: Stripe rifiuta e il negozio non viene pagato mai piu',
    ).not.toBe(primo[1].idempotencyKey);
  });

  it('lo stesso importo ritentato tiene la stessa chiave: niente doppio bonifico', async () => {
    state.ordine = ordinePronto();
    await releaseOrderPayout('o1');
    state.ordine = ordinePronto();
    await releaseOrderPayout('o1');

    const [primo, secondo] = transfersCreate.mock.calls;
    expect(
      secondo[1].idempotencyKey,
      'la protezione dal doppio bonifico e saltata: due volte gli stessi soldi',
    ).toBe(primo[1].idempotencyKey);
  });
});

/**
 * L'altra faccia della stessa medaglia. Mettere l'importo nella chiave sblocca
 * l'ordine che rimbalzava, ma toglie la rete che Stripe tendeva da sola: con
 * una chiave nuova, un bonifico che era passato davvero e la cui risposta si e'
 * persa verrebbe rifatto. Prima di versare un residuo si guarda se per questo
 * tentativo un bonifico esiste gia'.
 */
describe('un bonifico che era gia passato', () => {
  it('viene registrato, non rifatto', async () => {
    state.bonificiEsistenti = [
      { id: 'tr_gia_uscito', metadata: { order_id: 'o1', seller_id: 's1', tentativo: '0' } },
    ];
    state.ordine = {
      id: 'o1',
      seller_id: 's1',
      payout_status: 'HELD',
      delivery_status: 'DELIVERED',
      seller_payout_cents: 5000,
      // Una quota gia' addebitata: e' l'unico caso in cui l'importo, e quindi
      // la chiave, puo' cambiare fra due tentativi.
      seller_payout_reversed_cents: 2000,
      payout_tentativo: 0,
      stripe_charge_id: 'ch_1',
      stripe_transfer_group: 'order_o1',
    };

    const esito = await releaseOrderPayout('o1');

    expect(transfersCreate, 'i soldi escono due volte per lo stesso ordine').not.toHaveBeenCalled();
    expect(esito).toMatchObject({ ok: true, transferId: 'tr_gia_uscito' });
    expect(state.ordine.payout_status).toBe('TRANSFERRED');
  });

  it('un bonifico di un tentativo precedente, gia stornato, non blocca quello nuovo', async () => {
    // Contestazione vinta: il numero del tentativo e salito, il bonifico
    // vecchio e stato richiamato indietro. Quello li non e questo.
    state.bonificiEsistenti = [
      { id: 'tr_vecchio', metadata: { order_id: 'o1', seller_id: 's1', tentativo: '0' } },
    ];
    state.ordine = {
      id: 'o1',
      seller_id: 's1',
      payout_status: 'HELD',
      delivery_status: 'DELIVERED',
      seller_payout_cents: 5000,
      seller_payout_reversed_cents: 1000,
      payout_tentativo: 1,
      stripe_charge_id: 'ch_1',
      stripe_transfer_group: 'order_o1',
    };

    await releaseOrderPayout('o1');

    expect(
      transfersCreate,
      'il negozio ha vinto la contestazione e resterebbe senza soldi',
    ).toHaveBeenCalledTimes(1);
    expect(transfersCreate.mock.calls[0][0].amount).toBe(4000);
  });
});

describe('la chiave del compenso al fattorino', () => {
  function ordineConsegnato(extra: Riga = {}): Riga {
    return {
      id: 'o2',
      rider_id: 'r1',
      payment_method: 'card',
      delivery_status: 'DELIVERED',
      rider_payout_status: 'HELD',
      rider_fee_cents: 400,
      rider_payout_tentativo: 0,
      stripe_charge_id: 'ch_2',
      stripe_transfer_group: 'order_o2',
      ...extra,
    };
  }

  it('porta l importo anche lei', async () => {
    state.ordine = ordineConsegnato();
    await releaseRiderPayout('o2');
    state.ordine = ordineConsegnato({ rider_fee_cents: 600 });
    await releaseRiderPayout('o2');

    const [primo, secondo] = transfersCreate.mock.calls;
    expect(primo[0].amount).toBe(400);
    expect(secondo[0].amount).toBe(600);
    expect(
      secondo[1].idempotencyKey,
      'compenso cambiato e chiave uguale: il fattorino resta senza',
    ).not.toBe(primo[1].idempotencyKey);
  });
});
