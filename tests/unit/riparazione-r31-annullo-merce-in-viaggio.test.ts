import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R31-022 — «Annulla» dell'amministratore su un ordine in viaggio o già consegnato rimetteva a scaffale
 * merce che non c'è più.
 *
 * Il fattorino ha già ritirato la merce (PICKED_UP, OUT_FOR_DELIVERY) o il cliente ce l'ha (DELIVERED):
 * annullare l'ordine dal pannello non la riporta in negozio. Prima `restore_stock_for_order` partiva lo
 * stesso (contanti) e il rimborso la rimetteva (carta): il sito offriva pezzi che il negozio non ha.
 * Gira la rotta VERA dell'amministrazione con l'annullo VERO (lib/ordini/annulla.ts) su un database
 * finto; il rimborso con la carta (refundOrder) è finto e si guarda cosa gli si chiede. Negozio e
 * fattorino assegnato ricevono la campanella.
 */

const refundOrder = vi.fn(async (_a: Record<string, unknown>) => ({ refundId: 're_1' }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: Record<string, unknown>) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { req: unknown; user: unknown; params: unknown }) => unknown) =>
    (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ req, user: { id: 'admin1' }, params: ctx.params }),
}));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { POST } from '@/app/api/admin/orders/[id]/cancel/route';
import { finto, carrello } from './carrello-finto';

const rpcChiamate: string[] = [];
function preparaUnOrdine(pagamento: 'cod' | 'card', stato: string) {
  const [o] = carrello(['pane'], [1500], pagamento);
  Object.assign(o as Record<string, unknown>, { delivery_status: stato, rider_id: 'r1' });
  db = finto({ orders: [o], notifications: [] });
  db.rpc = (async (nome: string) => {
    rpcChiamate.push(nome);
    return { data: null, error: null };
  }) as never;
}
const rimessaAScaffale = () => rpcChiamate.filter((n) => n === 'restore_stock_for_order').length;
async function annullaDalPannello() {
  return (POST as unknown as (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>)(
    new Request('http://x', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
    { params: { id: 'pane' } },
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-29T12:00:00Z'), toFake: ['Date'] });
  rpcChiamate.length = 0;
  refundOrder.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R31-022 — contanti: la merce già col fattorino non torna a scaffale', () => {
  for (const stato of ['PICKED_UP', 'OUT_FOR_DELIVERY']) {
    it(`IL CASO DELLA VOCE — ordine ${stato}: annullato, merce non rimessa in vendita, negozio e fattorino avvisati`, async () => {
      preparaUnOrdine('cod', stato);
      const res = await annullaDalPannello();
      expect(res.status).toBe(200);
      expect(db.tabelle.orders![0].delivery_status).toBe('CANCELED');
      expect(rimessaAScaffale(), 'merce rimessa in vendita mentre ce l’ha il fattorino').toBe(0);
      const avvisati = (db.tabelle.notifications ?? []).map((n) => n.user_id);
      expect(avvisati).toEqual(expect.arrayContaining(['s0', 'r1']));
    });
  }

  it('controprova: un ordine ancora in negozio (accettato) annullato rimette la merce a scaffale, come prima', async () => {
    preparaUnOrdine('cod', 'ACCEPTED');
    const res = await annullaDalPannello();
    expect(res.status).toBe(200);
    expect(rimessaAScaffale()).toBe(1);
  });
});

describe('R31-022 — carta: il rimborso dell’annullo non rimette a scaffale la merce già uscita', () => {
  for (const stato of ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    it(`ordine ${stato}: al rimborso si dice che la merce non torna`, async () => {
      preparaUnOrdine('card', stato);
      const res = await annullaDalPannello();
      expect(res.status).toBe(200);
      expect(refundOrder).toHaveBeenCalledTimes(1);
      expect(refundOrder.mock.calls[0][0].merceNonTorna, 'il rimborso rimetterebbe a scaffale merce che non c’è').toBe(true);
    });
  }

  it('controprova: ordine ancora in negozio, il rimborso decide la merce come prima', async () => {
    preparaUnOrdine('card', 'READY');
    const res = await annullaDalPannello();
    expect(res.status).toBe(200);
    expect(refundOrder).toHaveBeenCalledTimes(1);
    expect(refundOrder.mock.calls[0][0].merceNonTorna).toBeUndefined();
  });
});
