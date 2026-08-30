import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R039) — IL RIMBORSO CHE LA BANCA RIFIUTA LASCIAVA IL NEGOZIO
 * STORNATO PER SEMPRE.
 *
 * Un rimborso non è finito quando Stripe lo accetta: qualche giorno dopo la
 * banca del cliente può rifiutarlo, e i soldi rientrano a noi. Quando succede,
 * il codice rimetteva a posto la parte del cliente — l'ordine torna «pagato» —
 * e si fermava lì.
 *
 * Ma il rimborso, al momento in cui era partito, aveva anche ripreso dal
 * negozio la sua quota e chiuso il suo bonifico ('REVERSED' o 'REFUNDED').
 * Quegli stati il giro dei bonifici non li guarda: cerca solo 'HELD' e
 * 'PENDING_SELLER_ONBOARDING'. Quindi quell'ordine non tornava MAI PIÙ fra i
 * candidati.
 *
 * Risultato: la piattaforma ha i soldi (rientrati), il cliente non è stato
 * rimborsato, e il negozio ha consegnato senza essere pagato. Tre parti
 * scontente sullo stesso ordine, e nessun processo che lo riapra.
 *
 * Adesso, quando i soldi rientrano, torna indietro anche quello che era stato
 * tolto al negozio — si SOTTRAE la quota di questo rimborso, non si azzera il
 * totale, perché lì dentro possono esserci storni di altri resi — e il bonifico
 * torna in coda. È lo stesso trattamento della contestazione vinta.
 */

type Ordine = {
  id: string;
  refunded_amount_cents: number;
  gross_total_cents: number;
  total_price: number;
  payment_status: string;
  payout_status: string;
  seller_payout_cents: number;
  seller_payout_reversed_cents: number;
  payout_tentativo?: number;
  stripe_transfer_id?: string | null;
};

const state: { ordini: Ordine[]; notifiche: string[] } = { ordini: [], notifiche: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({ refunds: { list: async () => ({ data: [] }) } }) }));
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: async () => ({ reversalId: null, reversedCents: 0 }),
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

import { handleRefundUpdated } from '@/lib/stripe/webhook/rimborsi';

/** Il rimborso che la banca ha respinto: i soldi sono rientrati a noi. */
function rimborsoRespinto(centesimi: number, ordineId = 'o1') {
  return {
    id: 're_1',
    status: 'failed',
    amount: centesimi,
    payment_intent: 'pi_1',
    metadata: { order_id: ordineId },
  } as unknown as Parameters<typeof handleRefundUpdated>[0];
}

beforeEach(() => {
  state.notifiche = [];
});

describe('quando la banca respinge un rimborso gia uscito', () => {
  it('il bonifico al negozio torna in coda, invece di restare chiuso per sempre', async () => {
    // Ordine da 50 €, di cui 45 spettavano al negozio. Il bonifico era gia
    // partito, il rimborso pieno l'ha richiamato indietro.
    state.ordini = [
      {
        id: 'o1',
        refunded_amount_cents: 5000,
        gross_total_cents: 5000,
        total_price: 50,
        payment_status: 'REFUNDED',
        payout_status: 'REVERSED',
        seller_payout_cents: 4500,
        seller_payout_reversed_cents: 4500,
        payout_tentativo: 0,
        stripe_transfer_id: 'tr_1',
      },
    ];

    await handleRefundUpdated(rimborsoRespinto(5000));

    const o = state.ordini[0];
    expect(o.payment_status, 'il cliente risulta ancora rimborsato e non ha ricevuto niente').toBe('PAID');
    expect(
      o.payout_status,
      'il negozio ha consegnato, i soldi sono tornati a noi e nessun giro lo ripaghera mai piu',
    ).toBe('HELD');
    expect(o.seller_payout_reversed_cents, 'al negozio resta addebitato un rimborso che non c e stato').toBe(0);
    expect(o.payout_tentativo, 'senza un tentativo nuovo Stripe restituisce il bonifico gia stornato').toBe(1);
  });

  it('se il bonifico non era ancora partito, torna semplicemente da pagare', async () => {
    state.ordini = [
      {
        id: 'o1',
        refunded_amount_cents: 5000,
        gross_total_cents: 5000,
        total_price: 50,
        payment_status: 'REFUNDED',
        // Rimborsato prima che il bonifico partisse: nessun transfer da rifare.
        payout_status: 'REFUNDED',
        seller_payout_cents: 4500,
        seller_payout_reversed_cents: 4500,
        payout_tentativo: 0,
        stripe_transfer_id: null,
      },
    ];

    await handleRefundUpdated(rimborsoRespinto(5000));

    expect(state.ordini[0].payout_status).toBe('HELD');
    expect(state.ordini[0].seller_payout_reversed_cents).toBe(0);
  });

  it('su un rimborso parziale respinto torna indietro solo la sua quota', async () => {
    // Ordine da 50 €: prima un reso da 10 € (di cui 9 a carico del negozio),
    // poi un altro da 20 € (18 a carico del negozio). Il secondo viene
    // respinto: al negozio devono tornare 18, non tutti e 27.
    state.ordini = [
      {
        id: 'o1',
        refunded_amount_cents: 3000,
        gross_total_cents: 5000,
        total_price: 50,
        payment_status: 'PARTIALLY_REFUNDED',
        payout_status: 'REFUNDED',
        seller_payout_cents: 4500,
        seller_payout_reversed_cents: 2700,
        payout_tentativo: 0,
        stripe_transfer_id: null,
      },
    ];

    await handleRefundUpdated(rimborsoRespinto(2000));

    const o = state.ordini[0];
    expect(o.refunded_amount_cents).toBe(1000);
    expect(o.payment_status).toBe('PARTIALLY_REFUNDED');
    expect(
      o.seller_payout_reversed_cents,
      'azzerando il totale il negozio si farebbe ripagare anche il reso di prima',
    ).toBe(900);
  });

  it('un ordine gia pagato al negozio non viene rimesso in coda', async () => {
    // Il rimborso parziale non aveva toccato il bonifico: non c e niente da
    // riaprire, e rimetterlo in «da pagare» lo farebbe pagare due volte.
    state.ordini = [
      {
        id: 'o1',
        refunded_amount_cents: 1000,
        gross_total_cents: 5000,
        total_price: 50,
        payment_status: 'PARTIALLY_REFUNDED',
        payout_status: 'TRANSFERRED',
        seller_payout_cents: 4500,
        seller_payout_reversed_cents: 900,
        payout_tentativo: 0,
        stripe_transfer_id: 'tr_1',
      },
    ];

    await handleRefundUpdated(rimborsoRespinto(1000));

    expect(state.ordini[0].payout_status, 'un bonifico gia uscito rimesso in coda esce due volte').toBe('TRANSFERRED');
  });
});
