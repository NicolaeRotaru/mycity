import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R120) — IL FATTORINO CONSEGNAVA GRATIS QUANDO IL CREDITO COPRIVA
 * IL CONTRASSEGNO.
 *
 * Sul contrassegno il fattorino non riceve nessun bonifico: si tiene il suo
 * compenso dal contante che ha in mano e rimette il resto (scelta dichiarata
 * nel commento #155 della rotta di conferma). Regge finche' il contante c'e'.
 *
 * Ma `total_price` e' il totale DOPO lo scomputo del credito MyCity, e il
 * credito in cassa e' acceso di default. Un cliente con 50 € di credito che
 * ordina 22 € in contrassegno fa nascere l'ordine con total_price = 0: il
 * fattorino consegna, non gli mette in mano nessuno, e non ha niente da cui
 * trattenersi i 3 € di compenso.
 *
 * Il guasto vero non era quello — era che il sistema lo dichiarava PAGATO.
 * La rotta scriveva `rider_payout_status = 'CASH_WITHHELD'` guardando il
 * compenso DOVUTO e non il contante davvero incassabile, e da li'
 * `releaseRiderPayout` usciva subito («COD: il compenso e gia trattenuto dal
 * contante»): quei soldi non sarebbero partiti mai piu'. Nemmeno la quadratura
 * se ne accorgeva — atteso 0, incassato 0, differenza 0, nessun avviso.
 *
 * Vale anche a meta': residuo 2 €, compenso 3 € → il fattorino ne perde 1 e
 * risulta pagato per intero.
 *
 * Adesso il conto e' uno solo: quello che si tiene davvero e' il minimo fra il
 * compenso e il contante, e la differenza resta un debito che passa dal giro
 * dei bonifici come tutti gli altri.
 */

type Riga = Record<string, unknown>;

const state: { ordine: Riga; profilo: Riga } = { ordine: {}, profilo: {} };
const transfersCreate = vi.fn(async (_corpo: Riga, _opts: { idempotencyKey: string }) => ({ id: 'tr_1' }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ transfers: { create: transfersCreate, list: vi.fn(async () => ({ data: [] })) } }),
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

import { compensoDalContante, contanteDaRimettereCents, compensoTrattenutoCents } from '@/lib/shipping';
import { releaseRiderPayout } from '@/lib/stripe/payout';

function ordineInContanti(extra: Riga = {}): Riga {
  return {
    id: 'o-cod',
    rider_id: 'rider-1',
    payment_method: 'cod',
    delivery_status: 'DELIVERED',
    // Ordine da 22 €, compenso del fattorino 3 €.
    total_price: 22,
    rider_fee_cents: 300,
    shipping_cost: 0,
    pickup_in_store: false,
    cash_confirmed_at: '2026-08-30T10:00:00Z',
    rider_payout_status: 'HELD',
    rider_payout_tentativo: 0,
    stripe_charge_id: null,
    stripe_transfer_group: 'order_o-cod',
    ...extra,
  };
}

describe('quanto del compenso il fattorino riesce davvero a tenersi', () => {
  it('col contante che basta se lo tiene tutto, e non resta niente da versare', () => {
    const conto = compensoDalContante({ total_price: 22, rider_fee_cents: 300, pickup_in_store: false });
    expect(conto.trattenutoCents).toBe(300);
    expect(conto.residuoDovutoCents).toBe(0);
  });

  it('col credito che copre tutto non ha in mano niente: il compenso resta dovuto per intero', () => {
    // Il caso vero: 50 € di credito, ordine da 22 €, spunta «usa il credito»
    // accesa di default. L'ordine nasce con total_price = 0.
    const conto = compensoDalContante({ total_price: 0, rider_fee_cents: 300, pickup_in_store: false });
    expect(
      conto.trattenutoCents,
      'il fattorino non ha in mano un euro: non puo tenersi niente',
    ).toBe(0);
    expect(
      conto.residuoDovutoCents,
      'il compenso di una consegna fatta davvero risulta gia pagato, e nessuno glielo versera mai',
    ).toBe(300);
  });

  it('col credito che copre quasi tutto se ne tiene una parte, e il resto resta dovuto', () => {
    const conto = compensoDalContante({ total_price: 2, rider_fee_cents: 300, pickup_in_store: false });
    expect(conto.trattenutoCents).toBe(200);
    expect(conto.residuoDovutoCents, 'un euro di compenso sparito senza che nessuno lo veda').toBe(100);
  });

  it('sul ritiro in negozio non c e consegna, quindi non c e ne compenso ne residuo', () => {
    const conto = compensoDalContante({ total_price: 0, rider_fee_cents: 300, pickup_in_store: true });
    expect(conto.trattenutoCents).toBe(0);
    expect(conto.residuoDovutoCents).toBe(0);
  });

  it('il contante da rimettere resta quello di prima: contante meno cio che si e tenuto', () => {
    // Guardia sulla parte gia' buona: la riparazione non deve spostare l'atteso
    // della quadratura di fine giornata.
    expect(contanteDaRimettereCents({ total_price: 22, rider_fee_cents: 300, pickup_in_store: false })).toBe(1900);
    expect(contanteDaRimettereCents({ total_price: 0, rider_fee_cents: 300, pickup_in_store: false })).toBe(0);
    expect(compensoTrattenutoCents({ rider_fee_cents: 300, pickup_in_store: false })).toBe(300);
  });
});

describe('il giro dei bonifici paga il compenso che il contante non copriva', () => {
  beforeEach(() => {
    transfersCreate.mockClear();
    state.profilo = { stripe_account_id: 'acct_rider', stripe_payouts_enabled: true };
  });

  it('ordine in contrassegno coperto dal credito: il residuo parte come bonifico', async () => {
    state.ordine = ordineInContanti({ total_price: 0 });
    const esito = await releaseRiderPayout('o-cod');

    expect(
      esito.ok,
      'il giro dei bonifici esce subito su tutti i contrassegni: il fattorino non prende niente',
    ).toBe(true);
    expect(transfersCreate).toHaveBeenCalledTimes(1);
    expect(transfersCreate.mock.calls[0][0].amount, 'versati centesimi diversi dal compenso dovuto').toBe(300);
    expect(state.ordine.rider_payout_status).toBe('TRANSFERRED');
  });

  it('coperto a meta: parte solo la differenza, non tutto il compenso', async () => {
    state.ordine = ordineInContanti({ total_price: 2 });
    await releaseRiderPayout('o-cod');
    expect(transfersCreate.mock.calls[0][0].amount, 'gli si versa anche quello che si e gia tenuto in contanti').toBe(100);
  });

  it('col contante che bastava non parte nessun bonifico: se l e gia tenuto lui', async () => {
    state.ordine = ordineInContanti({ total_price: 22, rider_payout_status: 'CASH_WITHHELD' });
    const esito = await releaseRiderPayout('o-cod');
    expect(esito.ok).toBe(false);
    expect(transfersCreate, 'pagato due volte: una in contanti e una col bonifico').not.toHaveBeenCalled();
  });

  it('finche il contante non e confermato non si versa niente: non si sa cosa ha in mano', async () => {
    state.ordine = ordineInContanti({ total_price: 0, cash_confirmed_at: null });
    const esito = await releaseRiderPayout('o-cod');
    expect(esito.ok).toBe(false);
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('con la carta non cambia niente: si versa il compenso intero', async () => {
    state.ordine = ordineInContanti({
      payment_method: 'card',
      total_price: 0,
      stripe_charge_id: 'ch_1',
      cash_confirmed_at: null,
    });
    await releaseRiderPayout('o-cod');
    expect(transfersCreate.mock.calls[0][0].amount).toBe(300);
  });
});
