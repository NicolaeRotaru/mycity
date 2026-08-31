import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cron expire-stale-orders (audit 🟠-16): chiude gli ordini orfani fermi in NEW.
 *
 * Garanzie testate:
 *  - COD orfano → ripristino stock + notifica, nessun rimborso;
 *  - carta pagato → rimborso reale via refundOrder (importo intero);
 *  - idempotenza → se il claim atomico NEW→CANCELED non matcha (già preso da
 *    un'altra esecuzione), NESSUN rimborso/annullo;
 *  - storno del credito wallet speso.
 */

const state: {
  candidates: Record<string, unknown>[];
  claimed: Array<{ id: string }>;
  /** Ogni update sugli ordini, per poter osservare il rimettere in coda. */
  updates: Record<string, unknown>[];
} = {
  candidates: [],
  claimed: [{ id: 'o1' }],
  updates: [],
};
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const notifInsert = vi.fn(async () => ({ error: null }));
const refundOrderMock = vi.fn(async (_opts: unknown) => ({ refundId: 're_1', reversedCents: 0 }));

function qb(result: unknown) {
  const chain = () => builder;
  const builder: Record<string, unknown> = {
    select: chain,
    eq: chain,
    lt: chain,
    limit: chain,
    update: chain,
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (arg: unknown) => refundOrderMock(arg) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => qb({ data: state.candidates, error: null }),
          update: (valori: Record<string, unknown>) => {
            state.updates.push(valori);
            return qb({ data: state.claimed, error: null });
          },
        };
      }
      if (table === 'notifications') return { insert: notifInsert };
      return { select: () => qb({ data: [], error: null }) };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

async function run() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST' }),
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  state.updates.length = 0;
  refundOrderMock.mockClear();
  notifInsert.mockClear();
  state.candidates = [];
  state.claimed = [{ id: 'o1' }];
});

describe('POST /api/cron/expire-stale-orders', () => {
  it('annulla un COD orfano: ripristina stock + notifica, nessun rimborso', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null, total_price: 20, wallet_applied_cents: 0 },
    ];
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, canceled: 1, refunded: 0 });
    expect(refundOrderMock).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.name === 'restore_stock_for_order' && c.args.p_order_id === 'o1')).toBe(true);
    expect(notifInsert).toHaveBeenCalled();
  });

  it('annulla un ordine carta pagato: rimborso intero via refundOrder', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1', total_price: 50, wallet_applied_cents: 0 },
    ];
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, canceled: 1, refunded: 1 });
    expect(refundOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', amountCents: 5000, notifyBuyer: true }),
    );
    // Sul percorso carta lo stock lo ripristina refundOrder, non il cron.
    expect(rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(false);
  });

  it('idempotente: claim a vuoto (già annullato) → nessun rimborso', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1', total_price: 50, wallet_applied_cents: 0 },
    ];
    state.claimed = []; // un'altra esecuzione ha già preso l'ordine
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, canceled: 0, refunded: 0 });
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it('se il rimborso non riesce, l\'ordine torna in coda invece di restare annullato', async () => {
    // Il difetto: l'ordine passava ad annullato e solo dopo si chiedeva il
    // rimborso. Se Stripe non rispondeva, al giro successivo l'ordine non era
    // più fra i candidati (la ricerca guarda solo quelli in NEW): annullato e
    // mai rimborsato, coi soldi del cliente fermi.
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1', total_price: 50, wallet_applied_cents: 0 },
    ];
    refundOrderMock.mockRejectedValueOnce(new Error('Stripe non risponde'));

    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, refunded: 0, failed: 1 });

    // Rimesso in NEW: il prossimo giro lo ripesca.
    const rimesso = state.updates.find(
      (u) => u.delivery_status === 'NEW' && u.canceled_at === null,
    );
    expect(rimesso).toBeTruthy();
  });

  it('storna il credito wallet speso', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null, total_price: 20, wallet_applied_cents: 500 },
    ];
    await run();
    expect(
      rpcCalls.some((c) => c.name === 'wallet_credit' && c.args.p_cents === 500 && c.args.p_user === 'u1'),
    ).toBe(true);
  });
  /**
   * 30/8/2026 (R126) — LO STESSO FATTO LASCIAVA DUE FORME DIVERSE NEL DATABASE.
   *
   * `annullaERimborsa` — la strada che usa il cliente quando annulla lui —
   * porta il pagamento da «in attesa» a «fallito» insieme all'annullamento.
   * Questo giro no: scriveva solo lo stato di consegna, e un contrassegno mai
   * accettato restava «in attesa di pagamento» per sempre. Chi legge i numeri
   * vedeva una coda di incassi che non esisteva, senza modo di distinguere un
   * ordine davvero in attesa da uno morto tre settimane prima.
   */
  it('un ordine annullato dal giro non resta «in attesa di pagamento»', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null, total_price: 20, wallet_applied_cents: 0 },
    ];
    await run();
    const annullamento = state.updates.find((u) => u.delivery_status === 'CANCELED');
    expect(annullamento, 'il giro non ha nemmeno annullato l\'ordine').toBeTruthy();
    expect(
      annullamento!.payment_status,
      'Il contrassegno mai accettato resta contato fra gli incassi in attesa: la stessa riga che il cliente annullando avrebbe segnato come fallita',
    ).toBe('FAILED');
  });

  it('un ordine gia pagato con la carta non viene marcato «fallito»', async () => {
    // Il pagamento c'e' stato davvero: a raccontarlo e' il rimborso, non un
    // «fallito» che direbbe il falso sui soldi incassati.
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1', total_price: 50, wallet_applied_cents: 0 },
    ];
    await run();
    const annullamento = state.updates.find((u) => u.delivery_status === 'CANCELED');
    expect(annullamento!.payment_status).toBeUndefined();
  });
});
