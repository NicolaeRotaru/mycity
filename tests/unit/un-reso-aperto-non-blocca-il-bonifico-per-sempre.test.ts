import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * UN RESO APERTO NON BLOCCA IL BONIFICO AL NEGOZIO PER SEMPRE.
 *
 * 27/8/2026 (R042) — Il giro dei bonifici esclude dai pagamenti gli ordini con
 * un reso in REQUESTED, APPROVED, SHIPPED_BACK o RECEIVED. La rotta `decide`
 * porta un reso a REFUNDED solo se il venditore indica subito un importo:
 * approvato senza importo, il reso resta in APPROVED. E il commento in cima a
 * quella rotta prometteva già una «transizione RECEIVED -> REFUNDED via altro
 * endpoint» che NON ESISTEVA — sotto `app/api/returns` c'erano due sole
 * cartelle, `create` e `[id]/decide`.
 *
 * Quindi: un cliente apre un reso, il negozio lo approva e aspetta la merce
 * indietro, e da quel momento il bonifico di quell'ordine è fermo per sempre —
 * anche se il reso poi non arriva o si chiude di persona. Il negozio vedeva «in
 * attesa» senza scadenza e telefonava; l'amministratore non aveva nessun
 * comando per sbloccare.
 *
 * Questa prova esercita il comando che prima non c'era.
 */

const VENDITORE = { id: 'seller-1' };

const stato: {
  reso: Record<string, unknown>;
  ordine: Record<string, unknown>;
  /** Le scritture su `returns`, con lo stato di partenza preteso. */
  scritture: Array<{ patch: Record<string, unknown>; daStato: string | null }>;
  righePrese: Array<{ id: string }>;
} = {
  reso: { id: 'r1', status: 'APPROVED', seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1', refund_amount_cents: null },
  ordine: { stripe_payment_intent: 'pi_1', payment_method: 'card', gross_total_cents: 3000, total_price: 30, refunded_amount_cents: 0 },
  scritture: [],
  righePrese: [{ id: 'r1' }],
};

const refundOrderMock = vi.fn(async () => ({ refundId: 'rf_1', reversedCents: 0 }));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: typeof VENDITORE }) => unknown) => () => handler({ user: VENDITORE }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: () => refundOrderMock() }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: stato.reso, error: null }) }) }) }),
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'returns') {
        return {
          update: (patch: Record<string, unknown>) => {
            let daStato: string | null = null;
            const catena: Record<string, unknown> = {
              eq: (colonna: string, valore: string) => {
                if (colonna === 'status') daStato = valore;
                return catena;
              },
              select: async () => {
                stato.scritture.push({ patch, daStato });
                return { data: stato.righePrese, error: null };
              },
              then: (r: (v: unknown) => unknown) => {
                stato.scritture.push({ patch, daStato });
                return r({ error: null });
              },
            };
            return catena;
          },
        };
      }
      if (tabella === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) }) };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from '@/app/api/returns/[id]/avanza/route';

function avanza(body: unknown) {
  const req = new Request('http://localhost/api/returns/r1/avanza', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'r1' }) });
}

const statiScritti = () => stato.scritture.map((s) => s.patch.status).filter(Boolean);

beforeEach(() => {
  stato.reso = { id: 'r1', status: 'APPROVED', seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1', refund_amount_cents: null };
  stato.ordine = { stripe_payment_intent: 'pi_1', payment_method: 'card', gross_total_cents: 3000, total_price: 30, refunded_amount_cents: 0 };
  stato.scritture = [];
  stato.righePrese = [{ id: 'r1' }];
  refundOrderMock.mockClear();
});

describe('chiudere un reso che non si è mai concluso', () => {
  it('IL CASO CHE ROMPEVA — il reso approvato e mai tornato si può chiudere, e il bonifico riparte', async () => {
    // La merce non è mai partita, o ci si è messi d'accordo di persona: prima
    // non esisteva nessun comando, e quei soldi restavano fermi per sempre.
    const res = await avanza({ stato: 'CANCELED', note: 'Risolto di persona in negozio.' });

    expect(res.status).toBe(200);
    expect(
      statiScritti(),
      'il reso resta in uno degli stati che tengono fermo il bonifico',
    ).toContain('CANCELED');
    expect(refundOrderMock, 'chiudere senza rimborso non deve far uscire soldi').not.toHaveBeenCalled();
  });

  it('la merce che torna indietro passa per le sue tappe', async () => {
    const res = await avanza({ stato: 'SHIPPED_BACK' });
    expect(res.status).toBe(200);
    expect(statiScritti()).toContain('SHIPPED_BACK');
  });

  it('IL CASO CHE ROMPEVA — merce ricevuta: il rimborso finale ora esiste', async () => {
    // È la transizione che il commento di `decide` prometteva da mesi e che
    // nessun endpoint faceva.
    stato.reso = { ...stato.reso, status: 'RECEIVED' };

    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 3000 });

    expect(res.status).toBe(200);
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    expect(statiScritti()).toContain('REFUNDED');
  });
});

describe('le tappe non si saltano', () => {
  it('non si rimborsa un reso che non è ancora tornato indietro', async () => {
    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 1000 });
    expect(res.status).toBe(409);
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it('un reso già chiuso non si riapre passando da qui', async () => {
    stato.reso = { ...stato.reso, status: 'REFUNDED' };
    const res = await avanza({ stato: 'CANCELED' });
    expect(res.status).toBe(409);
  });

  it('il rimborso non può superare quello che resta dell ordine', async () => {
    stato.reso = { ...stato.reso, status: 'RECEIVED' };
    stato.ordine = { ...stato.ordine, refunded_amount_cents: 2500 };

    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 3000 });

    expect(res.status, 'esce piu di quello che il cliente ha pagato').toBe(400);
    expect(refundOrderMock).not.toHaveBeenCalled();
    expect((await res.json()).error.message).toContain('5.00');
  });

  it('due schede aperte sullo stesso reso: la seconda non lo fa avanzare di nuovo', async () => {
    stato.righePrese = [];
    const res = await avanza({ stato: 'RECEIVED' });
    expect(res.status).toBe(409);
  });
});

describe('chi può far avanzare un reso', () => {
  it('un venditore che non è quello del reso non può', async () => {
    stato.reso = { ...stato.reso, seller_id: 'un-altro' };
    const res = await avanza({ stato: 'CANCELED' });
    expect(res.status).toBe(403);
  });
});
