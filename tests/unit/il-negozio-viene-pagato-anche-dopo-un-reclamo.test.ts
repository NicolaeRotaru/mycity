import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL NEGOZIO VIENE PAGATO ANCHE DOPO UN RECLAMO CHIUSO A FAVORE DEL CLIENTE.
 *
 * 27/8/2026 (R122 · R041) — La rotta che chiude un reclamo interno scriveva
 * `orders.internal_dispute_status = 'LOST'` su QUALUNQUE esito a favore del
 * cliente, senza guardare se un rimborso fosse davvero uscito e per quanto.
 *
 * Ma l'importo del rimborso è facoltativo, e la risoluzione senza importo è il
 * caso normale: il negozio rimedia in natura, riconsegna, sostituisce. E il
 * rimborso parziale è la seconda strada più battuta: il cliente viene
 * accontentato con pochi euro sui trenta dell'ordine.
 *
 * Il giro dei bonifici accetta solo `internal_dispute_status` vuoto o
 * 'RESOLVED'. Nessun punto del codice riporta mai indietro un 'LOST' — è
 * l'unica riga in tutto il repository che scrive quella colonna — e il reclamo
 * non si può riaprire. Quindi: reclamo chiuso, cliente contento, e il negozio
 * non veniva pagato MAI PIÙ per una vendita andata a buon fine. Senza errore,
 * senza avviso, senza una riga nei conti. Lo scopriva lui al controllo del
 * mese, ed è il tipo di episodio che fa staccare un negozio dal marketplace.
 *
 * Adesso 'LOST' resta solo per il caso che lo merita: il cliente è stato
 * rimborsato dell'INTERO ordine, quindi al negozio non spetta più niente.
 */

const ADMIN = { id: 'admin-1' };

const stato: {
  ordine: { stripe_payment_intent: string | null; payment_method: string; total_price: number };
  /** Quello che è stato scritto su `orders`. */
  scrittureOrdine: Record<string, unknown>[];
} = {
  ordine: { stripe_payment_intent: 'pi_1', payment_method: 'card', total_price: 30 },
  scrittureOrdine: [],
};

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (handler: (ctx: { user: typeof ADMIN }) => unknown) => () => handler({ user: ADMIN }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 'rf_1' })) }));
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
          update: (patch: Record<string, unknown>) => {
            stato.scrittureOrdine.push(patch);
            return { eq: async () => ({ error: null }) };
          },
        };
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

const NOTE = 'Il negozio ha riconsegnato il prodotto giusto al cliente.';

beforeEach(() => {
  stato.ordine = { stripe_payment_intent: 'pi_1', payment_method: 'card', total_price: 30 };
  stato.scrittureOrdine = [];
});

describe('reclamo chiuso a favore del cliente', () => {
  it('IL CASO CHE ROMPEVA — senza rimborso, il bonifico al negozio deve ripartire', async () => {
    // L'amministratore scrive la nota, lascia VUOTO il campo rimborso e preme
    // «A favore buyer»: prima l'ordine prendeva 'LOST' e restava fuori dai
    // candidati al pagamento a ogni giro, per sempre.
    const res = await risolvi({ status: 'resolved_buyer', notes: NOTE });

    expect(res.status).toBe(200);
    expect(
      statoScrittoSullOrdine(),
      'nessun rimborso è uscito, eppure il negozio è stato escluso dai bonifici per sempre',
    ).toEqual(['RESOLVED']);
  });

  it('IL CASO CHE ROMPEVA — rimborso parziale: il residuo deve tornare al negozio', async () => {
    // Ordine da 30 €, cliente accontentato con 5 €: al negozio spettano ancora
    // 25 € meno le commissioni, già scomputati da seller_payout_reversed_cents.
    const res = await risolvi({ status: 'resolved_buyer', notes: NOTE, refundCents: 500 });

    expect(res.status).toBe(200);
    expect(
      statoScrittoSullOrdine(),
      'il negozio ha consegnato, il cliente ha avuto 5 € e i restanti 25 € restano fermi da noi',
    ).toEqual(['RESOLVED']);
  });

  it('rimborso dell intero ordine: il negozio non ha più niente da incassare', async () => {
    const res = await risolvi({ status: 'resolved_buyer', notes: NOTE, refundCents: 3000 });

    expect(res.status).toBe(200);
    expect(statoScrittoSullOrdine()).toEqual(['LOST']);
  });
});

describe('reclamo chiuso a favore del negozio', () => {
  it('il bonifico riparte come prima', async () => {
    const res = await risolvi({ status: 'resolved_seller', notes: NOTE });
    expect(res.status).toBe(200);
    expect(statoScrittoSullOrdine()).toEqual(['RESOLVED']);
  });
});
