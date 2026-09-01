import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R038) — UNO STATO CHE IL DATABASE NON CONOSCE FACEVA CADERE TUTTA
 * LA REGISTRAZIONE DEL RIMBORSO.
 *
 * Quando Stripe rimborsa un cliente, il codice prova a riprendere dal negozio
 * la sua quota. Se quel recupero fallisce, l'ordine viene marcato
 * 'REVERSAL_FAILED': vuol dire «il cliente ha avuto indietro i soldi, dal
 * negozio non sono rientrati», ed è l'unico posto in cui quella perdita resta
 * scritta.
 *
 * Ma quello stato era sparito dall'elenco ammesso dal database: la migrazione
 * 119 ce l'aveva, la 124 — che ha ricreato lo stesso vincolo per aggiungerne un
 * altro — l'ha perso per strada. E siccome quello stato viaggia nella STESSA
 * scrittura di payment_status, dell'importo rimborsato e dello stato della
 * consegna, Postgres rifiutava la riga INTERA.
 *
 * Il caso peggiore diventava così il caso non registrato: cliente rimborsato,
 * soldi rimasti al negozio, e per il database l'ordine ancora «pagato e da
 * pagare» — che il giro dei bonifici può ancora pagare una seconda volta.
 *
 * La migrazione 130 rimette lo stato nell'elenco. Questa prova guarda l'altra
 * metà: che finché quel vincolo non è applicato, a cadere sia solo il
 * promemoria e non tutto il resto.
 */

type Ordine = {
  id: string;
  user_id: string;
  total_price: number;
  payout_status: string;
  payment_status: string;
  delivery_status: string;
  rider_payout_status?: string | null;
};

const state: {
  ordini: Ordine[];
  scritture: Array<{ id: string; valori: Record<string, unknown> }>;
  vincoloSenzaStornoFallito: boolean;
  notifiche: string[];
} = { ordini: [], scritture: [], vincoloSenzaStornoFallito: true, notifiche: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({ refunds: { list: async () => ({ data: [] }) } }) }));
// Il recupero dal negozio fallisce: è il caso che fa nascere 'REVERSAL_FAILED'.
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: async () => {
    throw new Error('conto Connect non raggiungibile');
  },
  reverseRiderTransfer: async () => ({ reversalId: null, reversedCents: 0 }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (titolo: string) => {
    state.notifiche.push(titolo);
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: state.ordini.map((o) => ({ ...o })), error: null }) }),
          update: (valori: Record<string, unknown>) => ({
            eq: (_c: string, id: string) => {
              // Il database vero rifiuta la riga INTERA se uno dei valori non
              // è nell'elenco ammesso dal vincolo. Codice 23514.
              if (state.vincoloSenzaStornoFallito && valori.payout_status === 'REVERSAL_FAILED') {
                return Promise.resolve({
                  error: { code: '23514', message: 'new row violates check constraint orders_payout_status_check' },
                });
              }
              state.scritture.push({ id, valori });
              const riga = state.ordini.find((o) => o.id === id);
              if (riga) Object.assign(riga, valori);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';

function chargeRimborsata() {
  return {
    id: 'ch_1',
    payment_intent: 'pi_1',
    refunded: true,
    amount: 2000,
    amount_refunded: 2000,
    refunds: { data: [{ id: 're_1', reason: 'requested_by_customer' }] },
  } as unknown as Parameters<typeof handleChargeRefunded>[0];
}

beforeEach(() => {
  state.ordini = [
    {
      id: 'o1',
      user_id: 'u1',
      total_price: 20,
      payout_status: 'TRANSFERRED',
      payment_status: 'PAID',
      delivery_status: 'DELIVERED',
      rider_payout_status: null,
    },
  ];
  state.scritture = [];
  state.notifiche = [];
  state.vincoloSenzaStornoFallito = true;
});

describe('quando il database non conosce ancora lo stato «storno fallito»', () => {
  it('il rimborso resta registrato lo stesso', async () => {
    await handleChargeRefunded(chargeRimborsata());

    expect(
      state.ordini[0].payment_status,
      'ordine ancora «pagato» dopo un rimborso uscito: il giro dei bonifici puo pagarlo una seconda volta',
    ).toBe('REFUNDED');
    const scritta = state.scritture.find((s) => s.id === 'o1');
    expect(scritta?.valori.refunded_amount_cents, 'l importo rimborsato non e stato scritto').toBe(2000);
  });

  it('gli amministratori vengono avvisati che quei soldi vanno recuperati a mano', async () => {
    await handleChargeRefunded(chargeRimborsata());
    expect(state.notifiche.some((t) => t.includes('Storno')), 'nessuno sa che quei soldi sono rimasti al negozio').toBe(true);
  });

  it('col vincolo aggiornato lo stato si scrive davvero, e resta la traccia della perdita', async () => {
    // Cioè: dopo la migrazione 130.
    state.vincoloSenzaStornoFallito = false;

    await handleChargeRefunded(chargeRimborsata());

    expect(state.ordini[0].payout_status).toBe('REVERSAL_FAILED');
    expect(state.ordini[0].payment_status).toBe('REFUNDED');
  });
});
