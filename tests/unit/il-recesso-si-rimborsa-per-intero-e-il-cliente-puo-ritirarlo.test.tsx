import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * IL RECESSO SI RIMBORSA PER INTERO, E IL CLIENTE PUO' RITIRARLO.
 *
 * 31/10/2026 — Il collaudo ha chiuso un recesso da 30 € con 1 centesimo: reso RECEIVED,
 * motivo CHANGED_MIND, POST avanza {stato:'REFUNDED', refundAmountCents:1} → 200. Merce
 * tornata, cliente senza rimborso, bonifico al negozio libero. Col recesso (Cod. Cons.
 * artt. 56-57) il rimborso e' l'intero dei prodotti resi, piu' la consegna se torna tutto;
 * sotto l'intero solo scrivendo il motivo, che arriva al cliente.
 *
 * Insieme, i tre casi nati dal primo giro: la scheda che offriva «Chiudi senza rimborso»
 * su un recesso approvato da 3 giorni (e la rotta poi diceva 409), e il recesso che il
 * cliente lascia cadere, che nessuno poteva chiudere: bonifico fermo almeno 14 giorni.
 *
 * Si chiama la rotta vera e si disegna la scheda vera.
 */

const GIORNO = 24 * 60 * 60 * 1000;
const fa = (giorni: number) => new Date(Date.now() - giorni * GIORNO).toISOString();

const stato: {
  utente: { id: string };
  ruolo: string;
  reso: Record<string, unknown>;
  ordine: Record<string, unknown>;
  righe: Array<Record<string, unknown>>;
  scritture: Array<Record<string, unknown>>;
  avvisi: Array<Record<string, unknown>>;
} = { utente: { id: 'seller-1' }, ruolo: 'seller', reso: {}, ordine: {}, righe: [], scritture: [], avvisi: [] };

const rimborsi = vi.hoisted(() => ({ chiesti: [] as number[] }));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: stato.utente, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({
  AccreditoGiaUscitoConAltroImporto: class extends Error {},
  RimborsoInAttesaDellaDivisione: class extends Error {},
  cosaMancaAlBonifico: vi.fn(async () => 'niente'),
  refundOrder: vi.fn(async ({ amountCents }: { amountCents: number }) => {
    rimborsi.chiesti.push(amountCents);
    return { refundId: 'rf_1', reversedCents: 0 };
  }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: stato.reso, error: null }) }) }) }),
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'returns') {
        return {
          update: (patch: Record<string, unknown>) => {
            const catena: Record<string, unknown> = {
              eq: () => catena,
              select: async () => {
                stato.scritture.push(patch);
                return { data: [{ id: 'r1' }], error: null };
              },
              then: (r: (v: unknown) => unknown) => {
                stato.scritture.push(patch);
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
      if (tabella === 'order_items') {
        return { select: () => ({ eq: async () => ({ data: stato.righe, error: null }) }) };
      }
      if (tabella === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: stato.ruolo }, error: null }) }) }) };
      }
      return {
        insert: async (riga: Record<string, unknown>) => {
          stato.avvisi.push(riga);
          return { error: null };
        },
      };
    },
  }),
}));

import { POST } from '@/app/api/returns/[id]/avanza/route';
import ReturnRequestCard, { type ReturnRow } from '@/components/seller/ReturnRequestCard';

function avanza(corpo: Record<string, unknown>) {
  const req = new Request('http://localhost/api/returns/r1/avanza', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'r1' }) });
}

const reso = (status: string, reason: string, extra: Record<string, unknown> = {}) => ({
  id: 'r1', status, reason, seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1',
  refund_amount_cents: null, refund_id: null, created_at: fa(3), decided_at: null, order_item_id: null,
  ...extra,
});
const rimborsato = () => stato.scritture.some((s) => s.status === 'REFUNDED');
const chiuso = () => stato.scritture.some((s) => s.status === 'CANCELED');

beforeEach(() => {
  stato.utente = { id: 'seller-1' };
  stato.ruolo = 'seller';
  stato.ordine = {
    seller_id: 'seller-1', user_id: 'b1', stripe_payment_intent: 'pi_1', payment_method: 'card',
    gross_total_cents: 3000, total_price: 30, refunded_amount_cents: 0, stripe_refund_id: null,
  };
  stato.righe = [];
  stato.scritture = [];
  stato.avvisi = [];
  rimborsi.chiesti = [];
});

describe('il recesso tornato in negozio si rimborsa per intero', () => {
  it('1 centesimo su 30 €, senza motivo: 409, nessun rimborso, il reso resta aperto', async () => {
    stato.reso = reso('RECEIVED', 'CHANGED_MIND');
    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 1 });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toMatch(/30\.00/);
    expect(rimborsato()).toBe(false);
    expect(rimborsi.chiesti).toEqual([]);
  });

  it("anche l'amministratore: 409", async () => {
    stato.utente = { id: 'admin-1' };
    stato.ruolo = 'admin';
    stato.reso = reso('RECEIVED', 'CHANGED_MIND');
    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 1 });
    expect(res.status).toBe(409);
    expect(rimborsi.chiesti).toEqual([]);
  });

  it("l'intero, 3000: 200 e il rimborso parte", async () => {
    stato.reso = reso('RECEIVED', 'CHANGED_MIND');
    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 3000 });
    expect(res.status).toBe(200);
    expect(rimborsi.chiesti).toEqual([3000]);
  });

  it('2000 col motivo scritto: 200, e il motivo resta nel reso e arriva al cliente', async () => {
    stato.reso = reso('RECEIVED', 'CHANGED_MIND');
    const motivo = 'Merce rovinata: scatola aperta e prodotto usato oltre la prova';
    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 2000, note: motivo });
    expect(res.status).toBe(200);
    expect(stato.scritture.find((s) => s.status === 'REFUNDED')?.decision_notes).toBe(motivo);
    expect(stato.avvisi.find((a) => a.user_id === 'b1')?.body).toBe(motivo);
  });

  it('un motivo di una lettera non vale: 409', async () => {
    stato.reso = reso('RECEIVED', 'CHANGED_MIND');
    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 2000, note: 'x' });
    expect(res.status).toBe(409);
  });

  it("reso di un solo prodotto su due: l'intero e' quel prodotto, non tutto l'ordine", async () => {
    stato.reso = reso('RECEIVED', 'CHANGED_MIND', { order_item_id: 'i2' });
    stato.righe = [
      { id: 'i1', unit_price: 10, quantity: 1 },
      { id: 'i2', unit_price: 10, quantity: 2 },
    ];
    expect((await avanza({ stato: 'REFUNDED', refundAmountCents: 1500 })).status).toBe(409);
    expect((await avanza({ stato: 'REFUNDED', refundAmountCents: 2000 })).status).toBe(200);
  });

  it('un prodotto danneggiato si puo\' rimborsare in parte senza la regola del recesso', async () => {
    stato.reso = reso('RECEIVED', 'DAMAGED');
    const res = await avanza({ stato: 'REFUNDED', refundAmountCents: 1 });
    expect(res.status).toBe(200);
  });
});

describe('i 14 giorni per rispedire contano dall\'approvazione, in rotta e in scheda', () => {
  const card = (status: string, extra: Partial<ReturnRow> = {}) => {
    const ret: ReturnRow = {
      id: 'r1', status, reason: 'CHANGED_MIND', notes: null, photo_urls: null,
      refund_amount_cents: null, decision_notes: null, created_at: fa(3), ...extra,
    };
    return renderToStaticMarkup(createElement(ReturnRequestCard, { ret, orderTotal: 30, onDecided: () => {} }));
  };

  it('approvato da 3 giorni: la scheda non offre «Chiudi senza rimborso»', () => {
    expect(card('APPROVED')).not.toContain('Chiudi senza rimborso');
  });

  it('approvato da 20 giorni e mai rispedito: la scheda la offre, e la rotta chiude', async () => {
    expect(card('APPROVED', { created_at: fa(25), decided_at: fa(20) })).toContain('Chiudi senza rimborso');
    stato.reso = reso('APPROVED', 'CHANGED_MIND', { created_at: fa(25), decided_at: fa(20) });
    expect((await avanza({ stato: 'CANCELED' })).status).toBe(200);
  });

  it('chiesto 20 giorni fa ma approvato 3 giorni fa: il cliente ha ancora tempo, 409', async () => {
    expect(card('APPROVED', { created_at: fa(20), decided_at: fa(3) })).not.toContain('Chiudi senza rimborso');
    stato.reso = reso('APPROVED', 'CHANGED_MIND', { created_at: fa(20), decided_at: fa(3) });
    expect((await avanza({ stato: 'CANCELED' })).status).toBe(409);
    expect(chiuso()).toBe(false);
  });
});

describe('il cliente ritira il suo recesso, e il bonifico riparte', () => {
  for (const status of ['REQUESTED', 'APPROVED']) {
    it(`in ${status}: il cliente lo chiude, e l'avviso va al negozio`, async () => {
      stato.utente = { id: 'b1' };
      stato.ruolo = 'buyer';
      stato.reso = reso(status, 'CHANGED_MIND');
      const res = await avanza({ stato: 'CANCELED' });
      expect(res.status).toBe(200);
      expect(chiuso()).toBe(true);
      expect(stato.avvisi.some((a) => a.user_id === 'seller-1')).toBe(true);
    });
  }

  it('con la merce gia\' in viaggio non si ritira piu\': 409', async () => {
    stato.utente = { id: 'b1' };
    stato.ruolo = 'buyer';
    stato.reso = reso('SHIPPED_BACK', 'CHANGED_MIND');
    expect((await avanza({ stato: 'CANCELED' })).status).toBe(409);
    expect(chiuso()).toBe(false);
  });

  it('il cliente non puo\' segnare il rimborso, e un estraneo non chiude niente: 403', async () => {
    stato.utente = { id: 'b1' };
    stato.ruolo = 'buyer';
    stato.reso = reso('RECEIVED', 'CHANGED_MIND');
    expect((await avanza({ stato: 'REFUNDED', refundAmountCents: 3000 })).status).toBe(403);
    stato.utente = { id: 'estraneo' };
    stato.reso = reso('REQUESTED', 'CHANGED_MIND');
    expect((await avanza({ stato: 'CANCELED' })).status).toBe(403);
    expect(chiuso()).toBe(false);
  });

  it('il negozio su un recesso in REQUESTED: 409 che indica una tappa che esiste (approvare), non «ricevuta»', async () => {
    stato.reso = reso('REQUESTED', 'CHANGED_MIND');
    const res = await avanza({ stato: 'CANCELED' });
    expect(res.status).toBe(409);
    const testo = JSON.stringify(await res.json());
    expect(testo).toMatch(/approvalo/);
    expect(testo).toMatch(/ritirare/);
    expect(testo).not.toMatch(/ricevuta/);
  });
});
