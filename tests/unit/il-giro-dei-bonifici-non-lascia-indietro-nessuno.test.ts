import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
// 31/8/2026 (R120) — il filtro degli stati ritentabili era ricopiato qui a
// mano: una copia che il giorno in cui l'originale cambia resta verde
// raccontando il mondo di ieri. Si sostituiscono solo le due funzioni che
// chiamano Stripe; gli elenchi di stati restano quelli veri.
vi.mock('@/lib/stripe/payout', async (originale) => {
  const vero = await originale<typeof import('@/lib/stripe/payout')>();
  return {
    ...vero,
    releaseOrderPayout: (id: string) => releaseOrderPayoutMock(id),
    releaseRiderPayout: (id: string) => releaseRiderPayoutMock(id),
  };
});

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
  const nonPrimaDi: Record<string, string> = {};
  let tetto = Infinity;
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
    not: (c: string, op: string, v: unknown) =>
      (v === null ? nonNulli.push(c) : op === 'lt' ? (nonPrimaDi[c] = String(v)) : null, b),
    or: (expr: string) => (gruppiOr.push(expr), b),
    lte: (c: string, v: string) => ((nonOltre[c] = v), b),
    lt: (c: string, v: string) => ((minoriDi[c] = v), b),
    limit: (n: number) => ((tetto = n), b),
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
        // not.lt come PostgREST: una colonna vuota non passa (NOT (NULL < x) e' NULL).
        for (const [c, v] of Object.entries(nonPrimaDi)) {
          if (r[c] == null || String(r[c]) < v) return false;
        }
        return passaTuttiGliOr(o);
      }).slice(0, tetto);
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
  // 31/10/2026 — i contanti passano da Stripe solo se consegnati dal giorno
  // scritto qui (lib/stripe/payout.ts, contantiPagabiliDaStripe). Le prove dei
  // contanti qui sotto parlano di ordini consegnati dopo quel giorno.
  vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-01-01');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
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
        delivered_at: dueOreFa(),
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
        delivered_at: dueOreFa(),
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
        delivered_at: dueOreFa(),
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
        delivered_at: dueOreFa(),
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
        delivered_at: dueOreFa(),
        seller_payout_cents: 10_000,
        seller_payout_reversed_cents: 0,
      },
    ];

    const esito = await giro();

    expect(esito.codReleased).toBe(1);
    expect(esito.codSaldoInsufficiente).toBe(false);
  });
});

describe('31/10 — i contanti gia pagati a mano non entrano nel conto del saldo', () => {
  // Al lancio il negozio i contanti li riceve con un bonifico a mano di Nicola
  // e l'ordine resta HELD. Stripe non li paghera' mai (releaseOrderPayout li
  // rifiuta): se il giro li somma lo stesso, dice «saldo insufficiente» quando
  // non e' vero e ferma i contanti che invece Stripe deve pagare.
  it('con la data accesa, i contanti vecchi pagati a mano non fermano il bonifico di quelli nuovi', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-10-01');
    state.saldoDisponibile = 5_000; // 50 €
    state.ordini = [
      // 100 € consegnati il 20/9: il negozio li ha gia' avuti a mano.
      { id: 'cod-a-mano', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED', seller_payout_cents: 10_000, seller_payout_reversed_cents: 0, delivered_at: '2026-09-20T10:00:00.000Z' },
      // 20 € consegnati dopo il giorno d'inizio: questi li paga Stripe.
      { id: 'cod-nuovo', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED', seller_payout_cents: 2_000, seller_payout_reversed_cents: 0, delivered_at: dueOreFa() },
    ];

    const esito = await giro();

    expect(esito.codSaldoInsufficiente, 'il saldo conta anche i contanti che Stripe non paghera mai').toBe(false);
    expect(state.notifiche, 'avviso falso: 20 € da pagare, 50 € sul saldo').toEqual([]);
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('cod-nuovo');
    expect(releaseOrderPayoutMock, 'il contante gia pagato a mano non va nemmeno provato').not.toHaveBeenCalledWith('cod-a-mano');
  });

  it('senza la data nessun contante parte da Stripe: niente avviso di saldo insufficiente', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '');
    state.saldoDisponibile = 1000;
    state.ordini = [
      { id: 'cod-a-mano', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED', seller_payout_cents: 10_000, seller_payout_reversed_cents: 0, delivered_at: dueOreFa() },
    ];

    const esito = await giro();

    expect(state.notifiche, 'avviso a Nicola per bonifici che non partiranno mai da Stripe').toEqual([]);
    expect(esito.codSaldoInsufficiente).toBe(false);
    expect(releaseOrderPayoutMock).not.toHaveBeenCalled();
  });

  it('duecento contanti vecchi pagati a mano non riempiono il lotto: quello nuovo parte lo stesso', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-10-01');
    const vecchi = Array.from({ length: 200 }, (_, i) => ({
      id: `cod-vecchio-${i}`, payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED',
      seller_payout_cents: 1_000, seller_payout_reversed_cents: 0, delivered_at: '2026-09-15T10:00:00.000Z',
    }));
    state.ordini = [
      ...vecchi,
      { id: 'cod-nuovo', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED', seller_payout_cents: 2_000, seller_payout_reversed_cents: 0, delivered_at: dueOreFa() },
    ];

    const esito = await giro();

    expect(releaseOrderPayoutMock, 'restano HELD per sempre: senza il giorno nella ricerca occupano tutto il lotto').toHaveBeenCalledWith('cod-nuovo');
    expect(esito.codReleased).toBe(1);
  });
});

describe('collaudo 31/10 (secondo giro) — il giro legge il giorno dei contanti come releaseOrderPayout', () => {
  // Il giorno si leggeva con Date.parse: «01/12/2026» diventava il 12 gennaio,
  // e la ricerca tirava dentro (e sommava nel saldo) i contrassegni di novembre
  // che Nicola aveva gia girato a mano.
  it('«01/12/2026»: i contanti di novembre pagati a mano non si rileggono e non si sommano nel saldo', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '01/12/2026');
    state.saldoDisponibile = 1_000; // 10 €
    state.ordini = [
      { id: 'cod-novembre', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED', seller_payout_cents: 10_000, seller_payout_reversed_cents: 0, delivered_at: '2026-11-10T10:00:00.000Z' },
    ];

    const esito = await giro();

    expect(releaseOrderPayoutMock, 'il contrassegno gia pagato a mano riparte da Stripe').not.toHaveBeenCalled();
    expect(state.notifiche, 'avviso di saldo insufficiente per 100 € che il negozio ha gia avuto').toEqual([]);
    expect(esito.codSaldoInsufficiente).toBe(false);
  });

  it('«2026-12-01»: la consegna delle 00:30 di Piacenza parte, quella delle 23:30 del giorno prima no', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-12-01');
    state.ordini = [
      // 00:30 del 1/12 a Piacenza = 23:30 del 30/11 a Greenwich.
      { id: 'cod-0030', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED', seller_payout_cents: 2_000, seller_payout_reversed_cents: 0, delivered_at: '2026-11-30T23:30:00.000Z' },
      // 23:30 del 30/11 a Piacenza: pagata a mano.
      { id: 'cod-2330', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED', seller_payout_cents: 2_000, seller_payout_reversed_cents: 0, delivered_at: '2026-11-30T22:30:00.000Z' },
    ];

    await giro();

    expect(releaseOrderPayoutMock, 'il giorno valeva dall una di notte di Piacenza').toHaveBeenCalledWith('cod-0030');
    expect(releaseOrderPayoutMock).not.toHaveBeenCalledWith('cod-2330');
  });
});

/**
 * 31/10/2026 — IL RECLAMO CHIUSO A FAVORE DEL NEGOZIO LIBERA IL BONIFICO.
 *
 * La prova non ricopia il trigger: legge l'ULTIMA definizione di
 * `public.dispute_block_payout()` fra le migrazioni (quella che il database
 * ha davvero) e la applica alla riga dell'ordine, come farebbe Postgres
 * all'apertura del reclamo. Poi chiude il reclamo come lo chiude
 * app/api/admin/disputes/[id]/resolve (`statoDelReclamoSullOrdine`) e lancia
 * il giro vero. Con la 063 il trigger scriveva 'OPEN' sulla colonna della
 * banca, che nessuno riporta indietro: il negozio non veniva pagato mai piu'.
 */
function ultimaFunzioneDelTrigger(): { file: string; corpo: string } {
  const cartella = join(process.cwd(), 'migrations');
  const file = readdirSync(cartella)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  let ultima: { file: string; corpo: string } | null = null;
  for (const f of file) {
    const testo = readFileSync(join(cartella, f), 'utf8').replace(/--[^\n]*/g, '');
    const m = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.dispute_block_payout\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/i.exec(testo);
    if (m) ultima = { file: f, corpo: m[1] };
  }
  if (!ultima) throw new Error('nessuna migrazione definisce public.dispute_block_payout()');
  return ultima;
}

/** Valuta una condizione SQL semplice (IS NULL, IS NOT NULL, = '…', <> '…', AND, OR, parentesi). */
function condizioneVera(cond: string, riga: Record<string, unknown>): boolean {
  const pezzi =
    cond.match(/\(|\)|\bAND\b|\bOR\b|[a-z_]+\s+IS\s+NOT\s+NULL|[a-z_]+\s+IS\s+NULL|[a-z_]+\s*(?:=|<>)\s*'[^']*'/gi) ?? [];
  if (pezzi.join('').replace(/\s+/g, '') !== cond.replace(/\s+/g, '')) {
    throw new Error(`condizione del trigger che la prova non sa leggere: ${cond}`);
  }
  let i = 0;
  const valore = (c: string) => riga[c] ?? null;
  const atomo = (): boolean => {
    const p = pezzi[i++];
    if (p === '(') {
      const v = oppure();
      i++;
      return v;
    }
    let m = /^([a-z_]+)\s+IS\s+NOT\s+NULL$/i.exec(p);
    if (m) return valore(m[1]) != null;
    m = /^([a-z_]+)\s+IS\s+NULL$/i.exec(p);
    if (m) return valore(m[1]) == null;
    m = /^([a-z_]+)\s*(=|<>)\s*'([^']*)'$/i.exec(p);
    if (m) return m[2] === '=' ? valore(m[1]) === m[3] : valore(m[1]) != null && valore(m[1]) !== m[3];
    throw new Error(`pezzo di condizione che la prova non sa leggere: ${p}`);
  };
  const eAnche = (): boolean => {
    let v = atomo();
    while (/^AND$/i.test(pezzi[i] ?? '')) {
      i++;
      const d = atomo();
      v = v && d;
    }
    return v;
  };
  const oppure = (): boolean => {
    let v = eAnche();
    while (/^OR$/i.test(pezzi[i] ?? '')) {
      i++;
      const d = eAnche();
      v = v || d;
    }
    return v;
  };
  return cond.trim() === '' ? true : oppure();
}

/** Quello che fa Postgres quando nasce una riga in `disputes` per questo ordine. */
function apriIlReclamo(ordine: Record<string, unknown>): void {
  const { file, corpo } = ultimaFunzioneDelTrigger();
  const m = /UPDATE\s+public\.orders\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?);/i.exec(corpo);
  if (!m) throw new Error(`${file}: dispute_block_payout non scrive su orders come la prova si aspetta:\n${corpo}`);
  const dove = m[2].replace(/^\s*id\s*=\s*NEW\.order_id\s*(AND\s*)?/i, '');
  if (!condizioneVera(dove, ordine)) return;
  for (const assegnazione of m[1].split(',')) {
    const a = /^\s*([a-z_]+)\s*=\s*(.+?)\s*$/i.exec(assegnazione);
    if (!a) throw new Error(`${file}: assegnazione che la prova non sa leggere: ${assegnazione}`);
    const v = a[2];
    if (/^'.*'$/.test(v)) ordine[a[1]] = v.slice(1, -1);
    else if (/^now\(\)$/i.test(v)) ordine[a[1]] = new Date().toISOString();
    else if (/^NULL$/i.test(v)) ordine[a[1]] = null;
    else throw new Error(`${file}: valore che la prova non sa leggere: ${v}`);
  }
}

/** Quello che scrive chi chiude il reclamo dal pannello (resolve/route.ts, scriviIlReclamoSullOrdine). */
async function chiudiIlReclamo(ordine: Record<string, unknown>, esito: { rimborsoEmesso: boolean; rimborsoPieno: boolean }) {
  const { statoDelReclamoSullOrdine } = await import('@/lib/rimborsi/regole-del-rimborso');
  // La pausa del carrello non si tocca (SENZA_LA_PAUSA_DEL_CARRELLO).
  if (ordine.internal_dispute_status !== 'RIMBORSO_DA_RIPARTIRE') ordine.internal_dispute_status = statoDelReclamoSullOrdine(esito);
}

describe('184 — il reclamo chiuso a favore del negozio libera di nuovo il bonifico', () => {
  const ordineConCarta = (): Ordine => ({
    id: 'carta-reclamo', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED',
    delivered_at: dueOreFa(), dispute_status: null, internal_dispute_status: null,
  });

  it('con il reclamo aperto il bonifico resta fermo', async () => {
    const o = ordineConCarta();
    apriIlReclamo(o as Record<string, unknown>);
    state.ordini = [o];
    await giro();
    expect(releaseOrderPayoutMock, 'reclamo aperto e il negozio viene pagato lo stesso').not.toHaveBeenCalled();
  });

  it('chiuso a favore del negozio, senza rimborso: il bonifico parte', async () => {
    const o = ordineConCarta();
    apriIlReclamo(o as Record<string, unknown>);
    await chiudiIlReclamo(o as Record<string, unknown>, { rimborsoEmesso: false, rimborsoPieno: false });
    state.ordini = [o];
    await giro();
    expect(releaseOrderPayoutMock, 'il trigger ha lasciato OPEN sulla colonna della banca: il negozio non viene pagato mai piu').toHaveBeenCalledWith('carta-reclamo');
  });

  it('chiuso con un rimborso parziale: il resto al negozio parte', async () => {
    const o = ordineConCarta();
    apriIlReclamo(o as Record<string, unknown>);
    await chiudiIlReclamo(o as Record<string, unknown>, { rimborsoEmesso: true, rimborsoPieno: false });
    state.ordini = [o];
    await giro();
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('carta-reclamo');
  });

  it('chiuso con il rimborso intero al cliente: al negozio non parte niente', async () => {
    const o = ordineConCarta();
    apriIlReclamo(o as Record<string, unknown>);
    await chiudiIlReclamo(o as Record<string, unknown>, { rimborsoEmesso: true, rimborsoPieno: true });
    state.ordini = [o];
    await giro();
    expect(releaseOrderPayoutMock).not.toHaveBeenCalled();
  });

  it('il reclamo non tocca la contestazione in banca: se la banca ha aperto, il bonifico resta fermo', async () => {
    const o: Ordine = { ...ordineConCarta(), dispute_status: 'OPEN' };
    apriIlReclamo(o as Record<string, unknown>);
    await chiudiIlReclamo(o as Record<string, unknown>, { rimborsoEmesso: false, rimborsoPieno: false });
    expect(o.dispute_status, 'chiudere il reclamo ha toccato la colonna della banca').toBe('OPEN');
    state.ordini = [o];
    await giro();
    expect(releaseOrderPayoutMock, 'pagato con i soldi che la banca ha gia ripreso').not.toHaveBeenCalled();
  });

  it('vale anche per i contanti: reclamo chiuso a favore del negozio, il contrassegno parte', async () => {
    const o: Ordine = {
      id: 'cod-reclamo-chiuso', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED',
      delivered_at: dueOreFa(), dispute_status: null, internal_dispute_status: null,
    };
    apriIlReclamo(o as Record<string, unknown>);
    await chiudiIlReclamo(o as Record<string, unknown>, { rimborsoEmesso: false, rimborsoPieno: false });
    state.ordini = [o];
    await giro();
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('cod-reclamo-chiuso');
  });
});
