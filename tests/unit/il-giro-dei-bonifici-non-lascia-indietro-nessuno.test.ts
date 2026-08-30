import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * IL GIRO DEI BONIFICI, QUATTRO DIFETTI TROVATI IL 27/8/2026.
 *
 * Il giro fa tre passaggi in fila: paga i negozi degli ordini con carta, paga i
 * fattorini, paga i negozi degli ordini in contanti. Questi quattro difetti
 * stanno tutti lì.
 *
 *  · (R040) il compenso del fattorino rimasto a metà non tornava in coda. Per
 *    il negozio quel recupero c'era già; per il fattorino no, e il suo compenso
 *    restava fermo in «in lavorazione» per sempre.
 *  · (R124) il passaggio dei contanti non guardava il reclamo interno, quello
 *    della carta sì: due negozi con lo stesso reclamo perso venivano trattati
 *    in modo opposto a seconda di come aveva pagato il cliente.
 *  · (R141) il tetto di tempo era uno solo per tutti e tre i passaggi: se il
 *    primo se lo mangiava, il secondo e il terzo non partivano affatto — e nel
 *    secondo ci sono i compensi dei fattorini.
 *  · (R044) i bonifici degli ordini in contanti escono dal saldo Stripe, ma i
 *    contanti raccolti dal fattorino su Stripe non entrano mai. Quando il saldo
 *    non basta, i bonifici falliscono uno a uno e l'ordine rimbalza fra «da
 *    pagare» e «in lavorazione» a ogni giro. Adesso il giro se ne accorge
 *    prima, si ferma e lo dice, invece di accumulare fallimenti.
 */

type Ordine = {
  id: string;
  payment_method?: string;
  payout_status?: string;
  delivery_status?: string;
  dispute_status?: string | null;
  internal_dispute_status?: string | null;
  payout_claimed_at?: string | null;
  rider_id?: string | null;
  rider_payout_status?: string | null;
  rider_payout_claimed_at?: string | null;
  seller_payout_cents?: number | null;
  seller_payout_reversed_cents?: number | null;
  delivered_at?: string | null;
};

const state: {
  ordini: Ordine[];
  saldoDisponibile: number;
  msPerBonifico: number;
  notifiche: Array<{ title: string }>;
  avvisoRecente: { alert_key: string } | null;
} = { ordini: [], saldoDisponibile: 1_000_000, msPerBonifico: 0, notifiche: [], avvisoRecente: null };

const releaseOrderPayoutMock = vi.fn(async (_id: string) => {
  // R141 — un bonifico vero e' una chiamata di rete: qui il tempo lo facciamo
  // passare a comando, cosi' la prova puo' misurare il tetto di durata.
  if (state.msPerBonifico > 0) vi.advanceTimersByTime(state.msPerBonifico);
  return { ok: true as const, transferId: 'tr_1' };
});
const releaseRiderPayoutMock = vi.fn(async (_id: string) => {
  if (state.msPerBonifico > 0) vi.advanceTimersByTime(state.msPerBonifico);
  return { ok: true as const, transferId: 'tr_r1' };
});

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    balance: {
      retrieve: async () => ({ available: [{ currency: 'eur', amount: state.saldoDisponibile }] }),
    },
  }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (title: string) => {
    state.notifiche.push({ title });
  },
}));
vi.mock('@/lib/stripe/payout', () => ({
  releaseOrderPayout: (id: string) => releaseOrderPayoutMock(id),
  releaseRiderPayout: (id: string) => releaseRiderPayoutMock(id),
  FILTRO_RIDER_RITENTABILI:
    'rider_payout_status.is.null,rider_payout_status.in.(HELD,PENDING_RIDER_ONBOARDING,FAILED)',
}));

/**
 * Finta tabella `orders` che rispetta davvero i filtri, comprese le condizioni
 * `or` scritte alla PostgREST: `colonna.is.null`, `colonna.eq.VALORE`,
 * `colonna.in.(A,B)`. Serve che siano vere: due dei quattro difetti stanno
 * esattamente in un filtro che manca.
 */
function tabellaOrdini(righe: Ordine[]) {
  const uguali: Record<string, unknown> = {};
  const dentro: Record<string, unknown[]> = {};
  const minoriDi: Record<string, string> = {};
  const nonOltre: Record<string, string> = {};
  const nonNulli: string[] = [];
  const gruppiOr: string[] = [];
  let scrittura: Record<string, unknown> | null = null;

  const passaUnaCondizione = (o: Ordine, cond: string): boolean => {
    const valore = (o as Record<string, unknown>)[cond.split('.')[0]] ?? null;
    if (cond.includes('.is.null')) return valore == null;
    const inMatch = cond.match(/^[a-z_]+\.in\.\((.*)\)$/);
    if (inMatch) return inMatch[1].split(',').includes(String(valore));
    const eqMatch = cond.match(/^[a-z_]+\.eq\.(.*)$/);
    if (eqMatch) return String(valore) === eqMatch[1];
    return true;
  };
  const passaTuttiGliOr = (o: Ordine): boolean =>
    gruppiOr.every((gruppo) => gruppo.split(',').some((cond) => passaUnaCondizione(o, cond)));

  const b: Record<string, unknown> = {
    select: () => b,
    update: (v: Record<string, unknown>) => ((scrittura = v), b),
    eq: (c: string, v: unknown) => ((uguali[c] = v), b),
    in: (c: string, v: unknown[]) => ((dentro[c] = v), b),
    is: () => b,
    not: (c: string, _op: string, v: unknown) => (v === null ? nonNulli.push(c) : null, b),
    or: (expr: string) => (gruppiOr.push(expr), b),
    lte: (c: string, v: string) => ((nonOltre[c] = v), b),
    lt: (c: string, v: string) => ((minoriDi[c] = v), b),
    limit: () => b,
    then: (risolvi: (x: unknown) => unknown) => {
      const fuori = righe.filter((o) => {
        const r = o as Record<string, unknown>;
        for (const [c, v] of Object.entries(uguali)) if (r[c] !== v) return false;
        for (const [c, v] of Object.entries(dentro)) if (!v.includes(r[c])) return false;
        for (const [c, v] of Object.entries(minoriDi)) {
          if (r[c] == null || String(r[c]) >= v) return false;
        }
        for (const [c, v] of Object.entries(nonOltre)) {
          if (r[c] == null || String(r[c]) > v) return false;
        }
        for (const c of nonNulli) if (r[c] == null) return false;
        return passaTuttiGliOr(o);
      });
      if (scrittura) for (const o of fuori) Object.assign(o, scrittura);
      return risolvi({ data: fuori.map((o) => ({ ...o })), error: null });
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') return tabellaOrdini(state.ordini);
      if (tabella === 'operational_alert_log') {
        // La memoria degli avvisi gia' mandati: qui parte sempre vuota, cosi'
        // il primo avviso esce e la prova puo' vederlo.
        return {
          select: () => ({
            eq: () => ({ gte: () => ({ maybeSingle: () => Promise.resolve({ data: state.avvisoRecente, error: null }) }) }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      // Nessun reso e nessuna contestazione aperta.
      return { select: () => ({ in: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) };
    },
  }),
}));

async function giro() {
  const { POST } = await import('@/app/api/cron/release-payouts/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST' }),
  );
  return res.json();
}

// Consegnato due ore fa: il cancello del bonifico e' «consegna + un'ora».
const dueOreFa = () => new Date(Date.now() - 2 * 3_600_000).toISOString();

beforeEach(() => {
  state.ordini = [];
  state.saldoDisponibile = 1_000_000;
  state.msPerBonifico = 0;
  state.notifiche = [];
  state.avvisoRecente = null;
  releaseOrderPayoutMock.mockClear();
  releaseRiderPayoutMock.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R040 — il compenso del fattorino rimasto a meta', () => {
  it('torna in coda se il turno e stato preso piu di quindici minuti fa', async () => {
    state.ordini = [
      {
        id: 'fattorino-appeso',
        payment_method: 'card',
        delivery_status: 'DELIVERED',
        rider_id: 'r1',
        rider_payout_status: 'PROCESSING',
        rider_payout_claimed_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        delivered_at: dueOreFa(),
      },
    ];

    const esito = await giro();

    expect(
      state.ordini[0].rider_payout_status,
      'il compenso resta in lavorazione per sempre: il fattorino ha consegnato e non viene pagato',
    ).toBe('HELD');
    expect(esito.riderAppesiRimessiInCoda).toBe(1);
  });

  it('non tocca un turno preso un minuto fa: quello sta ancora lavorando', async () => {
    state.ordini = [
      {
        id: 'in-corso',
        payment_method: 'card',
        delivery_status: 'DELIVERED',
        rider_id: 'r1',
        rider_payout_status: 'PROCESSING',
        rider_payout_claimed_at: new Date(Date.now() - 60_000).toISOString(),
        delivered_at: dueOreFa(),
      },
    ];

    const esito = await giro();

    expect(state.ordini[0].rider_payout_status, 'rischio di pagare due volte lo stesso compenso').toBe('PROCESSING');
    expect(esito.riderAppesiRimessiInCoda).toBe(0);
  });
});

describe('R124 — il reclamo interno vale anche sui contanti', () => {
  it('non paga un ordine in contanti con un reclamo interno aperto', async () => {
    state.ordini = [
      {
        id: 'cod-reclamo',
        payment_method: 'cod',
        payout_status: 'HELD',
        delivery_status: 'DELIVERED',
        internal_dispute_status: 'OPEN',
      },
    ];

    const esito = await giro();

    expect(
      esito.codReleased,
      'stesso reclamo perso, esito opposto a seconda di come ha pagato il cliente',
    ).toBe(0);
    expect(releaseOrderPayoutMock).not.toHaveBeenCalled();
  });

  it('paga normalmente quando il reclamo interno e chiuso', async () => {
    state.ordini = [
      {
        id: 'cod-ok',
        payment_method: 'cod',
        payout_status: 'HELD',
        delivery_status: 'DELIVERED',
        internal_dispute_status: 'RESOLVED',
      },
    ];

    const esito = await giro();
    expect(esito.codReleased).toBe(1);
  });
});

describe('R141 — ogni passaggio ha il suo tempo', () => {
  it('il compenso del fattorino parte anche se i negozi hanno consumato un minuto', async () => {
    vi.useFakeTimers();
    // Ogni bonifico si prende un minuto: due negozi bastano a superare il
    // vecchio tetto unico da cinquanta secondi.
    state.msPerBonifico = 60_000;
    state.ordini = [
      { id: 'neg1', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED', delivered_at: dueOreFa() },
      { id: 'neg2', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED', delivered_at: dueOreFa() },
      {
        id: 'consegna1',
        payment_method: 'card',
        payout_status: 'TRANSFERRED',
        delivery_status: 'DELIVERED',
        rider_id: 'r1',
        rider_payout_status: 'HELD',
        delivered_at: dueOreFa(),
      },
    ];

    const esito = await giro();

    expect(
      esito.riderReleased,
      'i negozi si sono mangiati tutto il tempo e i fattorini non vengono pagati per niente',
    ).toBe(1);
  });
});

describe('R051 — il bonifico parte quando dice la pagina Guadagni', () => {
  it('un ordine consegnato mezz ora fa non e ancora da pagare', async () => {
    state.ordini = [
      {
        id: 'appena-consegnato',
        payment_method: 'card',
        payout_status: 'HELD',
        delivery_status: 'DELIVERED',
        delivered_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      },
    ];
    expect((await giro()).released).toBe(0);
  });

  it('un ordine consegnato due ore fa viene pagato', async () => {
    // La pagina Guadagni e le domande frequenti dicevano «~24 ore» e «il giorno
    // 5 del mese»: se qualcuno riportasse l attesa a quei numeri, questo diventa
    // rosso. Le ore stanno in lib/stripe/tempi-bonifico.ts, una casa sola.
    state.ordini = [
      {
        id: 'da-pagare',
        payment_method: 'card',
        payout_status: 'HELD',
        delivery_status: 'DELIVERED',
        delivered_at: dueOreFa(),
      },
    ];
    expect((await giro()).released).toBe(1);
  });
});

describe('R044 — i contanti non entrano nel saldo Stripe', () => {
  it('non prova nemmeno a pagare se il saldo non copre i bonifici dei contanti', async () => {
    // Il negozio deve prendere 100 €, sul conto Stripe ce ne sono 10.
    state.saldoDisponibile = 1000;
    state.ordini = [
      {
        id: 'cod-grosso',
        payment_method: 'cod',
        payout_status: 'HELD',
        delivery_status: 'DELIVERED',
        seller_payout_cents: 10_000,
        seller_payout_reversed_cents: 0,
      },
    ];

    const esito = await giro();

    expect(
      releaseOrderPayoutMock,
      'ogni giro riprova e fallisce: l ordine rimbalza fra «da pagare» e «in lavorazione» all infinito',
    ).not.toHaveBeenCalled();
    expect(esito.codSaldoInsufficiente).toBe(true);
    expect(state.notifiche.length, 'nessuno ha avvisato che il saldo non basta').toBeGreaterThan(0);
  });

  it('non ripete l avviso a ogni giro: sarebbero cento notifiche al giorno', async () => {
    state.saldoDisponibile = 1000;
    state.avvisoRecente = { alert_key: 'PAYOUT_COD_SALDO_INSUFFICIENTE' };
    state.ordini = [
      {
        id: 'cod-grosso',
        payment_method: 'cod',
        payout_status: 'HELD',
        delivery_status: 'DELIVERED',
        seller_payout_cents: 10_000,
        seller_payout_reversed_cents: 0,
      },
    ];

    const esito = await giro();

    expect(esito.codSaldoInsufficiente, 'il freno deve restare tirato anche in silenzio').toBe(true);
    expect(state.notifiche.length, 'un avviso che arriva cento volte e un avviso che si impara a saltare').toBe(0);
  });

  it('paga normalmente quando il saldo basta', async () => {
    state.saldoDisponibile = 50_000;
    state.ordini = [
      {
        id: 'cod-piccolo',
        payment_method: 'cod',
        payout_status: 'HELD',
        delivery_status: 'DELIVERED',
        seller_payout_cents: 10_000,
        seller_payout_reversed_cents: 0,
      },
    ];

    const esito = await giro();

    expect(esito.codReleased).toBe(1);
    expect(esito.codSaldoInsufficiente).toBe(false);
  });
});
