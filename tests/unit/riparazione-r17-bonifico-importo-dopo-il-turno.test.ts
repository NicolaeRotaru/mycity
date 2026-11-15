import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R17-015 — Il bonifico al negozio usa l'importo letto DOPO aver preso il turno.
 *
 * `releaseOrderPayout` legge l'ordine, poi il profilo del negozio, poi prende il turno HELD→PROCESSING.
 * Se fra la lettura e il turno arriva la scrittura di un rimborso (il webhook del cruscotto toglie
 * 1,94 € dal bonifico da fare), il turno passa lo stesso perché lo stato è ancora HELD. Prima il
 * bonifico partiva col netto della prima lettura (18,00 €) e i 1,94 € non li riprendeva più nessuno.
 * Adesso si versa il residuo della riga presa col turno: 16,06 €. Lo stesso per il fattorino.
 */

const stato: { db: FintoDatabase; bonifici: Array<{ amount: number; metadata: Record<string, string> }> } = {
  db: fintoDatabase({}),
  bonifici: [],
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    transfers: {
      create: async (p: { amount: number; metadata: Record<string, string> }) => {
        stato.bonifici.push({ amount: p.amount, metadata: { ...p.metadata } });
        return { id: `tr_${stato.bonifici.length}` };
      },
      list: async () => ({ data: [] }),
    },
  }),
}));

import { releaseOrderPayout, releaseRiderPayout } from '@/lib/stripe/payout';

const ordine = () => stato.db.tabelle.orders!.find((r) => r.id === 'o1')!;

function ordineConsegnato(extra: Riga = {}): Riga {
  return {
    id: 'o1', seller_id: 'negozio1', rider_id: 'fattorino1',
    payout_status: 'HELD', seller_payout_cents: 1800, seller_payout_reversed_cents: 0, payout_tentativo: 0,
    stripe_charge_id: 'ch_1', stripe_transfer_group: 'order_o1', stripe_transfer_id: null,
    delivery_status: 'DELIVERED', payment_method: 'card', delivered_at: '2026-11-13T08:00:00.000Z',
    payout_claimed_at: null,
    rider_payout_status: null, rider_fee_cents: 390, shipping_cost: 3.9, rider_payout_tentativo: 0,
    total_price: 27.9, pickup_in_store: false, cash_confirmed_at: null,
    ...extra,
  };
}

/** Nell'istante fra la lettura e il turno arriva un'altra scrittura sulla stessa riga. */
function primaDelTurno(campoDelTurno: string, cambia: (r: Riga) => void) {
  let fatto = false;
  stato.db.guasto = (s) => {
    const v = s.valori as Riga | null;
    if (!fatto && s.tabella === 'orders' && s.operazione === 'update' && v && v[campoDelTurno] === 'PROCESSING') {
      fatto = true;
      cambia(ordine());
    }
    return null;
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
  stato.bonifici = [];
  stato.db = fintoDatabase({
    orders: [ordineConsegnato()],
    profiles: [
      { id: 'negozio1', stripe_account_id: 'acct_negozio', stripe_payouts_enabled: true },
      { id: 'fattorino1', stripe_account_id: 'acct_fattorino', stripe_payouts_enabled: true },
    ],
  });
});

describe('R17-015 · il bonifico parte con gli importi della riga presa col turno', () => {
  it('il rimborso scritto fra la lettura e il turno scende dal bonifico: 16,06 €, non 18,00', async () => {
    primaDelTurno('payout_status', (r) => { r.seller_payout_reversed_cents = 194; });

    const esito = await releaseOrderPayout('o1');

    expect(esito.ok).toBe(true);
    expect(stato.bonifici.map((b) => b.amount)).toEqual([1606]);
    expect(ordine().payout_status).toBe('TRANSFERRED');
    expect(ordine().seller_payout_reversed_cents).toBe(194);
  });

  it('senza niente in mezzo il bonifico è il netto intero, come sempre', async () => {
    await releaseOrderPayout('o1');
    expect(stato.bonifici.map((b) => b.amount)).toEqual([1800]);
  });

  it('il compenso del fattorino cambiato nello stesso istante si versa com è sulla riga presa col turno', async () => {
    primaDelTurno('rider_payout_status', (r) => { r.rider_fee_cents = 350; });

    const esito = await releaseRiderPayout('o1');

    expect(esito.ok).toBe(true);
    expect(stato.bonifici.map((b) => b.amount)).toEqual([350]);
    expect(ordine().rider_payout_status).toBe('TRANSFERRED');
  });
});
