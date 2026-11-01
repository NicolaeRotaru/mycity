import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * IL RECESSO SI RIMBORSA PER INTERO ANCHE DALLA PORTA «APPROVA».
 *
 * 31/10/2026 — Il collaudo: `avanza` rifiutava 1 centesimo su un recesso da 30 €, ma
 * `decide` con APPROVED e refundAmountCents=1 chiamava refundOrder(1) e scriveva REFUNDED.
 * La scheda del negozio offre il campo importo proprio accanto ad «Approva reso». Era la
 * stessa chiusura per l'altra porta: merce in viaggio o tornata, cliente con 1 centesimo,
 * bonifico al negozio libero.
 *
 * La regola (Cod. Cons. artt. 56-57) e' una sola, in lib/rimborsi/regole-del-rimborso.ts:
 * l'intero, oppure meno con il motivo scritto, che arriva al cliente. Anche per l'admin.
 */

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
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/stripe/payout', () => ({
  AccreditoGiaUscitoConAltroImporto: class extends Error {},
  RimborsoInAttesaDellaDivisione: class extends Error {},
  refundOrder: vi.fn(async ({ amountCents }: { amountCents: number }) => {
    rimborsi.chiesti.push(amountCents);
    return { refundId: 'rf_1', bonificoCents: 0 };
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

import { POST } from '@/app/api/returns/[id]/decide/route';
import ReturnRequestCard, { type ReturnRow } from '@/components/seller/ReturnRequestCard';

function decide(corpo: Record<string, unknown>) {
  const req = new Request('http://localhost/api/returns/r1/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'r1' }) });
}

const reso = (reason: string, extra: Record<string, unknown> = {}) => ({
  id: 'r1', status: 'REQUESTED', reason, seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1',
  refund_amount_cents: null, created_at: new Date().toISOString(), order_item_id: null,
  ...extra,
});
const rimborsato = () => stato.scritture.some((s) => s.status === 'REFUNDED');

beforeEach(() => {
  stato.utente = { id: 'seller-1' };
  stato.ruolo = 'seller';
  stato.ordine = {
    seller_id: 'seller-1', user_id: 'b1', stripe_payment_intent: 'pi_1', payment_method: 'card',
    gross_total_cents: 3000, total_price: 30, refunded_amount_cents: 0,
  };
  stato.righe = [];
  stato.scritture = [];
  stato.avvisi = [];
  rimborsi.chiesti = [];
});

describe('«Approva reso» con l\'importo: il recesso si rimborsa per intero', () => {
  it('1 centesimo su 30 €, senza motivo: 409, nessun rimborso, il reso non si tocca', async () => {
    stato.reso = reso('CHANGED_MIND');
    const res = await decide({ decision: 'APPROVED', refundAmountCents: 1 });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toMatch(/30\.00/);
    expect(rimborsi.chiesti).toEqual([]);
    expect(stato.scritture).toEqual([]);
  });

  it("anche l'amministratore: 409", async () => {
    stato.utente = { id: 'admin-1' };
    stato.ruolo = 'admin';
    stato.reso = reso('CHANGED_MIND');
    const res = await decide({ decision: 'APPROVED', refundAmountCents: 1 });
    expect(res.status).toBe(409);
    expect(rimborsi.chiesti).toEqual([]);
  });

  it("l'intero (3000): 200 e REFUNDED", async () => {
    stato.reso = reso('CHANGED_MIND');
    const res = await decide({ decision: 'APPROVED', refundAmountCents: 3000 });
    expect(res.status).toBe(200);
    expect(rimborsi.chiesti).toEqual([3000]);
    expect(rimborsato()).toBe(true);
  });

  it('meno (2000) col motivo scritto: 200, e il motivo sta nel reso e arriva al cliente', async () => {
    stato.reso = reso('CHANGED_MIND');
    const motivo = 'La scatola è tornata aperta e il prodotto usato oltre la prova';
    const res = await decide({ decision: 'APPROVED', refundAmountCents: 2000, notes: motivo });
    expect(res.status).toBe(200);
    expect(rimborsi.chiesti).toEqual([2000]);
    expect(stato.scritture.some((s) => s.decision_notes === motivo)).toBe(true);
    expect(stato.avvisi.some((a) => a.user_id === 'b1' && a.body === motivo)).toBe(true);
  });

  it("riga resa da 10 € su un ordine da 30: l'intero e' la riga", async () => {
    stato.reso = reso('CHANGED_MIND', { order_item_id: 'i1' });
    stato.righe = [
      { id: 'i1', unit_price: 10, quantity: 1 },
      { id: 'i2', unit_price: 17, quantity: 1 },
    ];
    expect((await decide({ decision: 'APPROVED', refundAmountCents: 999 })).status).toBe(409);
    expect(rimborsi.chiesti).toEqual([]);
    expect((await decide({ decision: 'APPROVED', refundAmountCents: 1000 })).status).toBe(200);
    expect(rimborsi.chiesti).toEqual([1000]);
  });

  it('un reso che non e\' un recesso (prodotto danneggiato) resta libero: 1 centesimo passa', async () => {
    stato.reso = reso('DAMAGED');
    const res = await decide({ decision: 'APPROVED', refundAmountCents: 1 });
    expect(res.status).toBe(200);
    expect(rimborsi.chiesti).toEqual([1]);
  });
});

describe('la scheda del negozio, su un recesso in attesa', () => {
  const riga = (reason: string): ReturnRow => ({
    id: 'r1', status: 'REQUESTED', reason, notes: null, photo_urls: null, refund_amount_cents: null,
    decision_notes: null, created_at: new Date().toISOString(), order_item_id: null, decided_at: null,
  });
  const disegna = (reason: string) =>
    renderToStaticMarkup(createElement(ReturnRequestCard, { ret: riga(reason), orderTotal: 30, onDecided: () => {} }));

  it('non offre «Rifiuta», e la nota chiede il motivo se si rimborsa meno', () => {
    const html = disegna('CHANGED_MIND');
    expect(html).not.toMatch(/Rifiuta/);
    expect(html).toMatch(/Approva reso/);
    expect(html).toMatch(/scrivi il motivo/);
  });

  it('su un reso normale «Rifiuta» resta', () => {
    expect(disegna('DAMAGED')).toMatch(/Rifiuta/);
  });
});
