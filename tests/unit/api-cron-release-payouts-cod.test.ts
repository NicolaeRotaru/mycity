import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * release-payouts — pass COD (🔴-1 slice 3). Invariante chiave "paga dopo
 * rimessa": un ordine COD viene pagato al venditore SOLO quando è in 'HELD'
 * (cioè dopo che l'admin ha confermato la rimessa del rider, AWAITING_REMITTANCE
 * → HELD). Un COD ancora in AWAITING_REMITTANCE NON deve essere pagato.
 */

type OrderRow = {
  id: string;
  payment_method: string;
  payout_status: string;
  delivery_status: string;
  dispute_status?: string | null;
  payout_claimed_at?: string | null;
  rider_payout_status?: string | null;
};
const state: { orders: OrderRow[] } = { orders: [] };
const releaseOrderPayoutMock = vi.fn(async (_id: string) => ({ ok: true as const, transferId: 'tr_1' }));
const releaseRiderPayoutMock = vi.fn(async (_id: string) => ({ ok: false as const, code: 'BAD_STATE' as const, reason: 'x' }));

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
// Gli stati dai quali un compenso rider si puo' ritentare vivono in payout.ts
// e li usa anche il cron: prima il cron aveva una sua copia dell'elenco, e
// 'HELD' mancava, quindi un compenso fallito non veniva piu' ripescato.
//
// 31/8/2026 (R120) — E QUI QUELLA COPIA ERA SCRITTA A MANO UN'ALTRA VOLTA.
// Il finto dichiarava l'elenco degli stati per conto suo: il giorno in cui
// quello vero cambia, questa prova resta verde raccontando il mondo di ieri.
// Adesso del modulo si sostituiscono solo le due funzioni che chiamano Stripe,
// e gli elenchi restano quelli veri.
vi.mock('@/lib/stripe/payout', async (originale) => {
  const vero = await originale<typeof import('@/lib/stripe/payout')>();
  return {
    ...vero,
    releaseOrderPayout: (id: string) => releaseOrderPayoutMock(id),
    releaseRiderPayout: (id: string) => releaseRiderPayoutMock(id),
  };
});

// Builder che rispetta i filtri eq/in rilevanti (payment_method, payout_status,
// delivery_status), così i tre pass (card-seller, rider, COD) vedono il subset giusto.
function ordersBuilder(rows: OrderRow[]) {
  const f: Record<string, unknown> = {};
  const ors: string[] = [];
  // Eleggibilità chargeback (audit 🟠-6): replica la semantica dei filtri reali.
  // .is('dispute_status', null) → solo righe null; .or('...is.null,...eq.WON') → null o WON.
  const disputeOk = (o: OrderRow): boolean => {
    if (f['isnull:dispute_status']) return o.dispute_status == null;
    const expr = ors.find((e) => e.includes('dispute_status'));
    if (expr) {
      const allowNull = expr.includes('dispute_status.is.null');
      const allowWon = expr.includes('dispute_status.eq.WON');
      return (allowNull && o.dispute_status == null) || (allowWon && o.dispute_status === 'WON');
    }
    return true;
  };
  // 22/8/2026 — il giro rimette in coda i turni rimasti appesi: la finta
  // tabella deve saper rispondere anche a una scrittura, non solo a una lettura.
  let patch: Record<string, unknown> | null = null;
  const b: Record<string, unknown> = {
    select: () => b,
    update: (v: Record<string, unknown>) => ((patch = v), b),
    eq: (c: string, v: unknown) => ((f[c] = v), b),
    in: (c: string, v: unknown[]) => ((f[`in:${c}`] = v), b),
    is: (c: string, v: unknown) => (v === null ? (f[`isnull:${c}`] = true) : null, b),
    not: () => b,
    or: (expr: string) => (ors.push(expr), b),
    lte: () => b,
    lt: (c: string, v: unknown) => ((f[`lt:${c}`] = v), b),
    limit: () => b,
    then: (resolve: (x: unknown) => unknown) => {
      const out = rows.filter(
        (o) =>
          (f.payment_method === undefined || o.payment_method === f.payment_method) &&
          (f.payout_status === undefined || o.payout_status === f.payout_status) &&
          (f.delivery_status === undefined || o.delivery_status === f.delivery_status) &&
          (f['in:payout_status'] === undefined || (f['in:payout_status'] as string[]).includes(o.payout_status)) &&
          // R120 — il passaggio dei fattorini cerca anche i contrassegni con
          // un compenso ancora dovuto: senza questo filtro la finta tabella li
          // dava a tutti. Dal 31/8/2026 quella ricerca chiede la LISTA degli
          // stati da cui si ritenta, non piu' il solo 'HELD', e la finta
          // tabella deve saperla applicare: se la ignorasse tornerebbe a
          // consegnare al giro anche i compensi gia' pagati.
          (f.rider_payout_status === undefined || o.rider_payout_status === f.rider_payout_status) &&
          (f['in:rider_payout_status'] === undefined ||
            (f['in:rider_payout_status'] as string[]).includes(o.rider_payout_status as string)) &&
          (f['lt:payout_claimed_at'] === undefined ||
            (o.payout_claimed_at != null && o.payout_claimed_at < (f['lt:payout_claimed_at'] as string))) &&
          disputeOk(o),
      );
      if (patch) for (const o of out) Object.assign(o, patch);
      return resolve({ data: out.map((o) => ({ id: o.id })), error: null });
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') return ordersBuilder(state.orders);
      // returns / disputes: nessun blocco
      return { select: () => ({ in: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) };
    },
  }),
}));

async function run() {
  const { POST } = await import('@/app/api/cron/release-payouts/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
}

beforeEach(() => {
  state.orders = [];
  releaseOrderPayoutMock.mockClear();
  releaseRiderPayoutMock.mockClear();
});

describe('release-payouts pass COD', () => {
  it('paga il venditore per un ordine COD in HELD (rimessa confermata)', async () => {
    state.orders = [{ id: 'cod1', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED' }];
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, codReleased: 1 });
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('cod1');
  });

  it('NON paga un COD ancora in AWAITING_REMITTANCE (gate rimessa)', async () => {
    state.orders = [
      { id: 'cod2', payment_method: 'cod', payout_status: 'AWAITING_REMITTANCE', delivery_status: 'DELIVERED' },
    ];
    const res = await run();
    expect((await res.json()).codReleased).toBe(0);
    expect(releaseOrderPayoutMock).not.toHaveBeenCalled();
  });
});

describe('release-payouts — chargeback (audit 🟠-6)', () => {
  it('[🟠-6] paga il venditore card con chargeback VINTO (dispute_status=WON)', async () => {
    state.orders = [
      { id: 'won1', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED', dispute_status: 'WON' },
    ];
    const res = await run();
    // Col codice vecchio (.is('dispute_status', null)) sarebbe escluso → released=0.
    expect((await res.json()).released).toBe(1);
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('won1');
  });

  it('[🟠-6] NON paga un ordine con chargeback APERTO (dispute_status=OPEN)', async () => {
    state.orders = [
      { id: 'open1', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED', dispute_status: 'OPEN' },
    ];
    const res = await run();
    expect((await res.json()).released).toBe(0);
    expect(releaseOrderPayoutMock).not.toHaveBeenCalledWith('open1');
  });

  it('[🟠-6] paga normalmente un ordine senza chargeback (dispute_status=null)', async () => {
    state.orders = [
      { id: 'ok1', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED', dispute_status: null },
    ];
    const res = await run();
    expect((await res.json()).released).toBe(1);
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('ok1');
  });
});

/**
 * 22/8/2026 — IL BONIFICO RIMASTO A META' TORNA IN CODA.
 *
 * `releaseOrderPayout` prende il turno scrivendo PROCESSING e poi chiama
 * Stripe. Se il processo muore in mezzo, quello stato resta scritto e i
 * candidati del giro dopo sono solo HELD e PENDING_SELLER_ONBOARDING: quel
 * pagamento non ripartiva mai piu', e per il negoziante il bonifico e' lo
 * stipendio.
 *
 * Questa prova diventa rossa se il recupero dei turni appesi sparisce.
 */
describe('release-payouts — i turni rimasti appesi', () => {
  it('rimette in coda un bonifico fermo in PROCESSING da piu di quindici minuti', async () => {
    const venti_minuti_fa = new Date(Date.now() - 20 * 60_000).toISOString();
    state.orders = [
      {
        id: 'appeso1',
        payment_method: 'card',
        payout_status: 'PROCESSING',
        delivery_status: 'DELIVERED',
        dispute_status: null,
        payout_claimed_at: venti_minuti_fa,
      },
    ];
    const res = await run();
    const body = await res.json();
    expect(body.appesiRimessiInCoda).toBe(1);
    expect(state.orders[0].payout_status).toBe('HELD');
  });

  it('NON tocca un turno preso un minuto fa: quello sta ancora lavorando', async () => {
    const un_minuto_fa = new Date(Date.now() - 60_000).toISOString();
    state.orders = [
      {
        id: 'invcorso1',
        payment_method: 'card',
        payout_status: 'PROCESSING',
        delivery_status: 'DELIVERED',
        dispute_status: null,
        payout_claimed_at: un_minuto_fa,
      },
    ];
    const res = await run();
    const body = await res.json();
    expect(body.appesiRimessiInCoda).toBe(0);
    expect(state.orders[0].payout_status).toBe('PROCESSING');
  });
});

/**
 * 30/8/2026 (R120) — IL COMPENSO DEL FATTORINO RIMASTO SCOPERTO DAL CONTANTE.
 *
 * Sul contrassegno il fattorino si tiene il compenso dal contante che ha in
 * mano, quindi il passaggio dei compensi cercava solo `payment_method='card'`.
 * Ma il credito MyCity porta il totale — e quindi il contante — sotto il
 * compenso, fino a zero: il fattorino consegna, non incassa niente, e una parte
 * del suo compenso resta dovuta. La conferma dell'incasso adesso la lascia in
 * 'HELD'; se il giro non la va a prendere, quei soldi restano lì per sempre.
 */
describe('release-payouts — il compenso in contanti rimasto scoperto', () => {
  it('ripesca un contrassegno con il compenso ancora dovuto', async () => {
    state.orders = [
      {
        id: 'codrider1',
        payment_method: 'cod',
        payout_status: 'AWAITING_REMITTANCE',
        delivery_status: 'DELIVERED',
        dispute_status: null,
        rider_payout_status: 'HELD',
      },
    ];
    await run();
    expect(
      releaseRiderPayoutMock,
      'il giro guarda solo i pagamenti con carta: il compenso scoperto dal credito non lo cerca nessuno',
    ).toHaveBeenCalledWith('codrider1');
  });

  it('lascia stare i contrassegni in cui il contante bastava', async () => {
    state.orders = [
      {
        id: 'codrider2',
        payment_method: 'cod',
        payout_status: 'AWAITING_REMITTANCE',
        delivery_status: 'DELIVERED',
        dispute_status: null,
        // Se l'e' gia' tenuto dal contante: non c'e' niente da versare.
        rider_payout_status: 'CASH_WITHHELD',
      },
    ];
    await run();
    expect(releaseRiderPayoutMock).not.toHaveBeenCalled();
  });
});
