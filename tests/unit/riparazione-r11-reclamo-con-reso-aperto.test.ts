import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R11-017 — Un reclamo chiuso mentre un reso sullo stesso ordine sta per tornare
 * indietro segnava l'ordine come perso: il «pieno» di refundOrder comprende la
 * prenotazione del reso in corso. Se il reso poi fallisce, nessuno riscrive
 * 'LOST' e il negozio non riceve più il resto che gli spetta.
 */

const ADMIN = { id: 'admin-1' };

const stato: {
  ordine: { stripe_payment_intent: string | null; payment_method: string; total_price: number };
  /** Quello che è stato scritto su `orders`. */
  scrittureOrdine: Record<string, unknown>[];
  resiAperti: { id: string; status?: string; refund_id?: string | null }[];
} = {
  resiAperti: [],
  ordine: { stripe_payment_intent: 'pi_1', payment_method: 'card', total_price: 30 },
  scrittureOrdine: [],
};

// 30/8/2026 (R017) — IL FINTO INVOLUCRO ADESSO FA QUELLO CHE FA QUELLO VERO.
//
// Prima gli involucri di `lib/api/middleware.ts` prendevano solo la richiesta, e
// ogni rotta dinamica si riscriveva a mano l'adattatore che risolveva i pezzi
// dell'indirizzo. Adesso li risolve l'involucro e li consegna nel contesto: il
// finto qui sotto deve fare lo stesso, altrimenti proverebbe una rotta che nel
// sito vero non esiste piu'.
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (handler: (ctx: { user: typeof ADMIN; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: ADMIN, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
// R76 — «intero» lo dice chi muove i soldi: il finto `refundOrder` risponde col
// suo verdetto, come quello vero (pieno quando copre i 30 € dell'ordine).
vi.mock('@/lib/stripe/payout', () => ({
  refundOrder: vi.fn(async (o: { amountCents: number }) => ({
    refundId: 'rf_1', reversedCents: 0, pieno: o.amountCents >= 3000, modo: 'carta',
    importoCents: o.amountCents, creditoCents: 0, bonificoCents: 0,
  })),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'disputes') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'd1', status: 'open', order_id: 'o1', opener_id: 'b1', against_id: 's1' },
                error: null,
              }),
            }),
          }),
          update: () => {
            const catena: Record<string, unknown> = {
              eq: () => catena,
              in: () => catena,
              select: async () => ({ data: [{ id: 'd1' }], error: null }),
              then: (r: (v: unknown) => unknown) => r({ error: null }),
            };
            return catena;
          },
        };
      }
      if (tabella === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) }),
          // 16/10/2026 — la scrittura porta anche il filtro che lascia stare la
          // pausa del carrello (`.or(...)`): qui la catena lo accetta e basta.
          update: (patch: Record<string, unknown>) => {
            stato.scrittureOrdine.push(patch);
            const catena: Record<string, unknown> = {
              eq: () => catena,
              or: () => catena,
              then: (r: (v: unknown) => unknown) => r({ error: null }),
            };
            return catena;
          },
        };
      }
      // R11-017 — la rotta guarda se c'è un reso aperto sullo stesso ordine: qui nessuno.
      if (tabella === 'returns') {
        const catena: Record<string, unknown> = {
          select: () => catena,
          eq: () => catena,
          // Collaudo K04 — il finto database rispetta il filtro sugli stati.
          in: async (_c: string, stati: string[]) => ({
            data: stato.resiAperti.filter((r) => stati.includes(r.status ?? '')),
            error: null,
          }),
        };
        return catena;
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from '@/app/api/admin/disputes/[id]/resolve/route';

function risolvi(body: unknown) {
  const req = new Request('http://localhost/api/admin/disputes/d1/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'd1' }) });
}

const statoScrittoSullOrdine = () =>
  stato.scrittureOrdine.map((p) => p.internal_dispute_status).filter(Boolean);

const NOTE = 'Il cliente ha ragione: rimborso completo.';

beforeEach(() => {
  stato.ordine = { stripe_payment_intent: 'pi_1', payment_method: 'card', total_price: 30 };
  stato.scrittureOrdine = [];
  stato.resiAperti = [];
});

describe('R11-017 — rimborso «pieno» con un reso ancora aperto', () => {
  it('con un reso aperto sullo stesso ordine non si scrive LOST', async () => {
    stato.resiAperti = [{ id: 'reso-1', status: 'APPROVED' }];
    const res = await risolvi({ status: 'resolved_buyer', notes: NOTE, refundCents: 3000 });
    expect(res.status).toBe(200);
    expect(statoScrittoSullOrdine(), 'il reso può ancora fallire: LOST toglie al negozio il resto per sempre').toEqual(['RESOLVED']);
  });

  it('reso già REFUNDED ma col rimborso ancora in corso (senza refund_id): non si scrive LOST', async () => {
    stato.resiAperti = [{ id: 'reso-2', status: 'REFUNDED', refund_id: null }];
    await risolvi({ status: 'resolved_buyer', notes: NOTE, refundCents: 3000 });
    expect(statoScrittoSullOrdine(), 'nella finestra di avanza il reso non si vede e si scrive LOST').toEqual(['RESOLVED']);
  });

  it('reso rimborsato e finito (refund_id scritto) o rifiutato: il rimborso pieno resta LOST', async () => {
    stato.resiAperti = [{ id: 'reso-3', status: 'REFUNDED', refund_id: 're_1' }, { id: 'reso-4', status: 'REJECTED' }];
    await risolvi({ status: 'resolved_buyer', notes: NOTE, refundCents: 3000 });
    expect(statoScrittoSullOrdine()).toEqual(['LOST']);
  });

  it('senza resi aperti il rimborso pieno resta LOST', async () => {
    const res = await risolvi({ status: 'resolved_buyer', notes: NOTE, refundCents: 3000 });
    expect(res.status).toBe(200);
    expect(statoScrittoSullOrdine()).toEqual(['LOST']);
  });
});
