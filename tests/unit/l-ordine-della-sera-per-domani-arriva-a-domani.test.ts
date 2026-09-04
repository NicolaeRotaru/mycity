import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scadenzaAccettazione } from '@/lib/ordini/scadenza-accettazione';

/**
 * L'ORDINE DELLA SERA PER DOMANI DEVE ARRIVARE A DOMANI.
 *
 * Il caso, coi numeri veri: martedì alle 21:15 il cliente ordina il pane per
 * «Domani · 9:00–12:00». Da oggi la cassa lo accetta (`negozioPuoServire`
 * guarda la fascia, non l'orologio), e il cliente riceve la conferma.
 *
 * Il lavoro notturno però annullava ogni ordine fermo in NEW da tre ore, senza
 * leggere la fascia: alle 00:15 l'ordine moriva da solo, col negozio chiuso e
 * nessuno che potesse accettarlo. Pagato con carta, erano addebito e rimborso
 * nella stessa notte.
 *
 * Qui si esegue il giro vero della rotta con un finto database, in due scene:
 * ① l'ordine per domani che deve sopravvivere alla notte;
 * ② l'ordine per adesso, che dopo tre ore deve continuare a essere annullato —
 *    altrimenti la «riparazione» sarebbe solo un cron spento.
 */

const state: {
  candidates: Record<string, unknown>[];
  claimed: Array<{ id: string }>;
  updates: Record<string, unknown>[];
} = { candidates: [], claimed: [{ id: 'o1' }], updates: [] };

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

async function giroNotturno() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST' }),
  );
}

/** Martedì 3 settembre 2026, 21:15 in Italia (ora legale, quindi 19:15 UTC). */
const ORDINATO_ALLE_2115 = '2026-09-03T19:15:00.000Z';
/** Tre ore e mezza dopo: le 00:45 italiane, il giro in cui l'ordine moriva. */
const NOTTE_FONDA = new Date('2026-09-03T22:45:00.000Z');

beforeEach(() => {
  rpcCalls.length = 0;
  state.updates.length = 0;
  state.candidates = [];
  state.claimed = [{ id: 'o1' }];
  refundOrderMock.mockClear();
  notifInsert.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(NOTTE_FONDA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('la scadenza di un ordine guarda la fascia scelta', () => {
  it('l\'ordine delle 21:15 per domani 9:00–12:00 scade a domani, non fra tre ore', () => {
    const scadenza = scadenzaAccettazione({
      created_at: ORDINATO_ALLE_2115,
      delivery_slot: 'Domani · 9:00–12:00',
    });
    // 12:00 italiane del 4 settembre = 10:00 UTC.
    expect(scadenza?.toISOString()).toBe('2026-09-04T10:00:00.000Z');
  });

  it('l\'ordine per adesso continua a scadere dopo tre ore', () => {
    const scadenza = scadenzaAccettazione({
      created_at: ORDINATO_ALLE_2115,
      delivery_slot: 'Adesso · arrivo in 30-60 min',
    });
    expect(scadenza?.toISOString()).toBe('2026-09-03T22:15:00.000Z');
  });

  it('la fascia di stasera sposta la scadenza alla fine della fascia', () => {
    // Ordine delle 14:00 italiane (12:00 UTC) per «Stasera · 18:00–20:00»:
    // scade alle 20:00 italiane, non alle 17:00.
    const scadenza = scadenzaAccettazione({
      created_at: '2026-09-03T12:00:00.000Z',
      delivery_slot: 'Stasera · 18:00–20:00',
    });
    expect(scadenza?.toISOString()).toBe('2026-09-03T18:00:00.000Z');
  });
});

describe('il giro notturno di /api/cron/expire-stale-orders', () => {
  it('non annulla l\'ordine della sera promesso per domani mattina', async () => {
    state.candidates = [
      {
        id: 'o1',
        user_id: 'u1',
        payment_method: 'card',
        payment_status: 'PAID',
        stripe_payment_intent: 'pi_1',
        total_price: 12,
        wallet_applied_cents: 0,
        created_at: ORDINATO_ALLE_2115,
        delivery_slot: 'Domani · 9:00–12:00',
      },
    ];

    const res = await giroNotturno();

    expect(await res.json()).toMatchObject({ ok: true, canceled: 0, refunded: 0, rinviati: 1 });
    expect(
      state.updates.find((u) => u.delivery_status === 'CANCELED'),
      'il pane ordinato alle 21:15 per domani alle 9 è stato annullato nel cuore della notte',
    ).toBeFalsy();
    expect(
      refundOrderMock,
      'addebito e rimborso nella stessa notte su un ordine che nessuno aveva ancora potuto accettare',
    ).not.toHaveBeenCalled();
  });

  it('annulla comunque l\'ordine per la consegna immediata fermo da più di tre ore', async () => {
    state.candidates = [
      {
        id: 'o1',
        user_id: 'u1',
        payment_method: 'cod',
        payment_status: 'PENDING',
        stripe_payment_intent: null,
        total_price: 20,
        wallet_applied_cents: 0,
        created_at: ORDINATO_ALLE_2115,
        delivery_slot: 'Adesso · arrivo in 30-60 min',
      },
    ];

    const res = await giroNotturno();

    expect(await res.json()).toMatchObject({ ok: true, canceled: 1, rinviati: 0 });
    expect(state.updates.find((u) => u.delivery_status === 'CANCELED')).toBeTruthy();
    expect(rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(true);
  });
});
