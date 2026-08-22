import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /api/rider/cash-confirm — guard atomico contro la "doppia cassa".
 *
 * La conferma incasso COD deve essere idempotente sotto concorrenza: due
 * richieste simultanee non possono entrambe scrivere cash_collected_cents.
 * Il meccanismo è l'UPDATE condizionato `.is('cash_confirmed_at', null)`: se la
 * riga è già stata confermata, l'update non matcha (0 righe) e la seconda
 * richiesta riceve 409. Questo test simula proprio quella corsa: la prima lettura
 * vede cash_confirmed_at = null (finestra TOCTOU) ma l'update atomico ritorna 0
 * righe → 409. Senza il guard la route risponderebbe 200 e sovrascriverebbe.
 *
 * Supabase (server + admin) è mockato; ApiErrors e zod sono reali.
 */

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

const state: {
  user: { id: string };
  order: Record<string, unknown> | null;
  claimed: Array<{ id: string }>;
  reconRows: Array<Record<string, unknown>>;
} = {
  user: { id: 'rider-1' },
  order: null,
  claimed: [],
  reconRows: [],
};

// Query-builder chainabile e "awaitable" che risolve sempre a `result`.
export const filtriVisti: { in: unknown[][] } = { in: [] };
/** Cosa è stato scritto sull'ordine alla conferma (#155). */
export const aggiornamenti: Array<Record<string, unknown>> = [];
/** Cosa è finito nella quadratura giornaliera (#155). */
export const quadrature: Array<Record<string, unknown>> = [];

function qb(result: unknown) {
  const chain = () => builder;
  const builder: Record<string, unknown> = {
    select: chain,
    eq: chain,
    is: chain,
    gte: chain,
    lte: chain,
    lt: chain,
    in: (...args: unknown[]) => { filtriVisti.in.push(args); return builder; },
    order: chain,
    limit: chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: { id: string }; req: unknown }) => unknown) =>
    (req: unknown) =>
      handler({ user: state.user, req }),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: state.order, error: state.order ? null : new Error('not found') }),
        }),
      }),
    }),
  }),
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          // UPDATE condizionato (doppia cassa): risolve a state.claimed
          update: (valori: Record<string, unknown>) => {
            aggiornamenti.push(valori);
            return qb({ data: state.claimed, error: null });
          },
          // SELECT della riconciliazione: risolve alle righe consegnate/incassate
          select: () => qb({ data: state.reconRows, error: null }),
        };
      }
      if (table === 'cod_reconciliations') {
        return {
          upsert: (riga: Record<string, unknown>) => {
            quadrature.push(riga);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'profiles') return { select: () => qb({ data: [], error: null }) };
      if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
      return { select: () => qb({ data: [], error: null }) };
    },
  }),
}));

function reqWith(body: Record<string, unknown>) {
  // 22/8/2026 — QUI C'ERA UNA RICHIESTA FINTA CON DENTRO SOLO `json()`.
  // Adesso il corpo lo legge un lettore col tetto, che ha bisogno di una
  // richiesta vera: la finta non aveva ne' `body` ne' `arrayBuffer`, quindi
  // provava una cosa che in produzione non succede mai.
  return new Request('http://localhost/prova', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

async function callPost(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/rider/cash-confirm/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(reqWith(body));
}

beforeEach(() => {
  filtriVisti.in.length = 0;
  aggiornamenti.length = 0;
  quadrature.length = 0;
  state.user = { id: 'rider-1' };
  // Ordine COD da €10 (sotto la soglia €50, niente prova obbligatoria).
  state.order = {
    id: ORDER_ID,
    rider_id: 'rider-1',
    total_price: 10,
    // Compenso del fattorino: 3 euro, fisso (lib/constants).
    rider_fee_cents: 300,
    shipping_cost: 0,
    pickup_in_store: false,
    payment_method: 'cod',
    delivery_status: 'DELIVERED',
    cash_confirmed_at: null,
  };
  state.claimed = [{ id: ORDER_ID }];
  state.reconRows = [{ total_price: 10, cash_collected_cents: 700, rider_fee_cents: 300, shipping_cost: 0, pickup_in_store: false }];
});

describe('POST /api/rider/cash-confirm', () => {
  it('prima conferma valida → 200', async () => {
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(res.status).toBe(200);
  });

  it('doppia conferma concorrente: la seconda riceve 409 (guard atomico)', async () => {
    // L'UPDATE condizionato non matcha: un'altra richiesta ha già vinto la corsa.
    state.claimed = [];
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(res.status).toBe(409);
  });

  it('incasso già confermato (fast-path) → 409', async () => {
    state.order = { ...(state.order as object), cash_confirmed_at: '2026-01-01T00:00:00Z' };
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(res.status).toBe(409);
  });

  it('ordine di un altro rider → 403', async () => {
    state.user = { id: 'rider-2' };
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(res.status).toBe(403);
  });

  it('ordine non COD → 409', async () => {
    state.order = { ...(state.order as object), payment_method: 'card' };
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(res.status).toBe(409);
  });

  // 056 / 172 — Il commento in cima al file dichiarava una guardia che nel
  // codice non c'era: un fattorino poteva marcare PAGATO un ordine appena
  // assegnato, mai ritirato e mai consegnato. La guardia ora vive DENTRO la
  // stessa UPDATE atomica, e questa prova cerca proprio lì: se qualcuno la
  // rimette in un `if` o la toglie, questa diventa rossa.
  it('la conferma dell\'incasso filtra sullo stato di consegna dentro la UPDATE', async () => {
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(res.status).toBe(200);
    const filtroStato = filtriVisti.in.find(
      (args) => args[0] === 'delivery_status',
    );
    expect(filtroStato).toBeTruthy();
    expect(filtroStato?.[1]).toEqual(['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']);
  });

  /**
   * #155 — IL FATTORINO NON VENIVA PAGATO PER NESSUNA CONSEGNA IN CONTANTI.
   *
   * Gli si chiedeva di rimettere TUTTO il contante, fee di consegna compresa,
   * e l'unica funzione che paga un fattorino esce subito sugli ordini in
   * contanti: nessun bonifico partiva mai. Consegnava e non prendeva niente.
   *
   * Adesso il compenso se lo tiene dal contante che ha in mano: l'atteso è il
   * totale meno il suo compenso, qui e nella quadratura di fine giornata.
   */
  it('l\'atteso è il totale meno il compenso che il fattorino si tiene', async () => {
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(res.status).toBe(200);
    const corpo = await res.json();
    // Ordine da 10 euro, compenso 3: in cassa deve tornare 7, non 10.
    expect(corpo.expectedCents).toBe(700);
    expect(corpo.delta).toBe(0);
  });

  it('la quadratura di fine giornata usa lo stesso atteso', async () => {
    await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(quadrature[0]?.expected_cents).toBe(700);
    expect(quadrature[0]?.status).toBe('OK');
  });

  it('il compenso trattenuto viene scritto sull\'ordine, invece di restare vuoto per sempre', async () => {
    await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
    expect(aggiornamenti[0]?.rider_payout_status).toBe('CASH_WITHHELD');
    expect(aggiornamenti[0]?.rider_payout_at).toBeTruthy();
  });

  it('sul ritiro in negozio non c\'è consegna, quindi non c\'è compenso da trattenere', async () => {
    state.order = { ...(state.order as object), pickup_in_store: true };
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 1000 });
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.expectedCents).toBe(1000);
  });

  // 189 — La giornata di cassa è quella di Piacenza, non quella di Greenwich:
  // d'estate le consegne fra le 22 e mezzanotte finivano nel giorno dopo.
  it('la quadratura usa il giorno di Piacenza, non quello UTC', async () => {
    vi.useFakeTimers();
    try {
      // 30 giugno, 22:30 a Piacenza = 20:30 UTC. Il giorno giusto è il 30, non il 1º luglio.
      vi.setSystemTime(new Date('2026-06-30T20:30:00Z'));
      const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 700 });
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
