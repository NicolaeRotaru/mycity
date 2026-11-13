/**
 * R14-002 — Confermata una rimessa, la giornata del fattorino risultava versata
 * anche per i contanti incassati dopo, e la guardia della cancellazione lo
 * lasciava andare.
 *
 * La regola sul «versato» vive nel database (migrazione 381, provata da
 * `tests/sql/rls/riparazione-r14-rimessa.test.sql`): la giornata e' versata solo
 * se non resta un ordine in contanti consegnato quel giorno e da versare.
 *
 * Qui la parte TypeScript:
 *  ① la rotta della rimessa ricalcola la giornata subito dopo la funzione, cosi'
 *    una giornata che la rimessa lascia aperta ha subito l'incassato e lo stato
 *    veri — senza mai scrivere il «versato», che e' del database;
 *  ② la guardia della cancellazione e il sorvegliante, provati direttamente con
 *    le righe che il database lascia dopo la 381.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const RIDER = '22222222-2222-4222-8222-222222222222';
const GIORNO = '2026-11-10';

type Chiamata = { tabella: string; valori: Record<string, unknown>; opzioni: unknown };

const stato: {
  rpc: { data: unknown; error: null | { message: string } };
  ordini: Array<Record<string, unknown>>;
  erroreOrdini: null | { message: string };
  finestra: { gte?: [string, string]; lt?: [string, string] };
  upsert: Chiamata[];
} = {
  rpc: { data: null, error: null },
  ordini: [],
  erroreOrdini: null,
  finestra: {},
  upsert: [],
};

const rpcMock = vi.fn(async () => stato.rpc);

/** Un client amministrativo finto: legge gli ordini e registra cosa scrive. */
function fintoAdmin() {
  return {
    from(tabella: string) {
      if (tabella === 'orders') {
        const catena = {
          select: () => catena,
          eq: () => catena,
          gte: (c: string, v: string) => {
            stato.finestra.gte = [c, v];
            return catena;
          },
          lt: async (c: string, v: string) => {
            stato.finestra.lt = [c, v];
            return { data: stato.erroreOrdini ? null : stato.ordini, error: stato.erroreOrdini };
          },
        };
        return catena;
      }
      return {
        upsert: async (valori: Record<string, unknown>, opzioni: unknown) => {
          stato.upsert.push({ tabella, valori, opzioni });
          return { error: null };
        },
      };
    },
  };
}

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() };

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { req: unknown; user: { id: string } }) => unknown) =>
    (req: unknown) =>
      h({ req, user: { id: 'admin-1' } }),
}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ rpc: rpcMock }),
  getAdminSupabase: () => fintoAdmin(),
}));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => null, isStripeConfigured: () => false }));

async function rimessa(body: unknown) {
  const { POST } = await import('@/app/api/admin/cod-remittance/route');
  const req = new Request('http://localhost/api/admin/cod-remittance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (POST as unknown as (r: Request) => Promise<Response>)(req);
}

/** Due consegne in contanti del 10 novembre: T con l'incasso, S senza. */
const T = { total_price: '25.00', cash_collected_cents: 2050, rider_fee_cents: 450, shipping_cost: null, pickup_in_store: false };
const S = { total_price: '25.00', cash_collected_cents: null, rider_fee_cents: 450, shipping_cost: null, pickup_in_store: false };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T19:30:00.000Z'));
  stato.rpc = { data: { rilasciati: 1, saltati_senza_incasso: 1 }, error: null };
  stato.ordini = [T, S];
  stato.erroreOrdini = null;
  stato.finestra = {};
  stato.upsert = [];
  rpcMock.mockClear();
  logger.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('① la rotta della rimessa ricalcola la giornata subito dopo la funzione', () => {
  it('la rimessa che salta un ordine senza incasso lascia la giornata con lo stato vero: MISMATCH', async () => {
    const res = await rimessa({ riderId: RIDER, date: GIORNO });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, released: 1, saltatiSenzaIncasso: 1 });
    expect(rpcMock).toHaveBeenCalledWith('confirm_cod_remittance', { p_rider: RIDER, p_date: GIORNO });

    const scritte = stato.upsert.filter((c) => c.tabella === 'cod_reconciliations');
    expect(
      scritte,
      'dopo la rimessa la giornata non si ricalcola: la guardia legge ancora i numeri di prima fino al giro notturno',
    ).toHaveLength(1);
    expect(scritte[0].valori).toMatchObject({
      rider_id: RIDER,
      for_date: GIORNO,
      expected_cents: 4100,
      collected_cents: 2050,
      status: 'MISMATCH',
    });
  });

  it('il ricalcolo guarda il giorno di Piacenza della rimessa, mezzanotte compresa', async () => {
    await rimessa({ riderId: RIDER, date: GIORNO });
    // Il 10 novembre a Piacenza (ora solare, +1) va dalle 23:00 del 9 alle 23:00 del 10 in UTC.
    expect(stato.finestra.gte).toEqual(['delivered_at', '2026-11-09T23:00:00.000Z']);
    expect(stato.finestra.lt).toEqual(['delivered_at', '2026-11-10T23:00:00.000Z']);
  });

  it('il ricalcolo non scrive mai il «versato»: lo decide solo la funzione nel database', async () => {
    await rimessa({ riderId: RIDER, date: GIORNO });
    const scritte = stato.upsert.filter((c) => c.tabella === 'cod_reconciliations');
    expect(scritte).toHaveLength(1);
    expect(Object.keys(scritte[0].valori)).not.toContain('remitted_at');
    expect(Object.keys(scritte[0].valori)).not.toContain('remitted_by');
  });

  it('se il ricalcolo non riesce la rimessa resta confermata, e il guasto si scrive', async () => {
    stato.erroreOrdini = { message: 'connessione persa' };
    const res = await rimessa({ riderId: RIDER, date: GIORNO });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, released: 1 });
    expect(stato.upsert).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      '[admin] quadratura della giornata non aggiornata dopo la rimessa',
      expect.objectContaining({ riderId: RIDER, giorno: GIORNO }),
    );
  });

  it('se la funzione fallisce non si ricalcola niente', async () => {
    stato.rpc = { data: null, error: { message: 'forbidden' } };
    const res = await rimessa({ riderId: RIDER, date: GIORNO });
    expect(res.status).toBe(500);
    expect(stato.upsert).toHaveLength(0);
  });
});

describe('② la guardia della cancellazione, con le righe che il database lascia dopo la 381', () => {
  const fintoRegistro = (righe: Array<Record<string, unknown>>) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: righe, error: null }),
        }),
      }),
    }) as never;

  // ① della prova SQL: rimessa di A, poi B incassato e consegnato lo stesso
  // giorno. Con la 381 la giornata torna aperta; il ricalcolo conta A e B.
  const giornataRiaperta = { for_date: GIORNO, collected_cents: 4100, status: 'OK', remitted_at: null };
  // ② della prova SQL: un ordine consegnato senza incasso, la rimessa lo salta.
  const giornataConSaltato = { for_date: '2026-08-20', collected_cents: 2050, status: 'MISMATCH', remitted_at: null };
  // Versato anche B: la giornata si richiude.
  const giornataRichiusa = { for_date: GIORNO, collected_cents: 4100, status: 'OK', remitted_at: '2026-11-10T21:00:00Z' };

  it('il fattorino con B ancora in tasca non si cancella: la cancellazione si rinvia', async () => {
    const { contantiAncoraDaVersare } = await import('@/lib/account/cancellazione');
    const cassa = await contantiAncoraDaVersare(fintoRegistro([giornataRiaperta]), RIDER);
    expect(cassa.bloccante).toBe(true);
    expect(cassa.esito).toBe('da_versare');
    expect(cassa.giornate).toBe(1);
  });

  it('nemmeno con un ordine saltato dalla rimessa: un ammanco da chiarire', async () => {
    const { contantiAncoraDaVersare } = await import('@/lib/account/cancellazione');
    const cassa = await contantiAncoraDaVersare(fintoRegistro([giornataConSaltato]), RIDER);
    expect(cassa.bloccante).toBe(true);
    expect(cassa.esito).toBe('da_versare');
  });

  it('versato tutto, la cancellazione riparte', async () => {
    const { contantiAncoraDaVersare } = await import('@/lib/account/cancellazione');
    const cassa = await contantiAncoraDaVersare(fintoRegistro([giornataRichiusa]), RIDER);
    expect(cassa.bloccante).toBe(false);
    expect(cassa.esito).toBe('libera');
  });

  it('il sorvegliante conta la stessa persona fra i rinvii decisi da noi, non fra i guasti', async () => {
    const { sorvegliaCancellazioni } = await import('@/lib/privacy/cancellazioni-in-sospeso');
    const esito = sorvegliaCancellazioni(
      [{ userId: RIDER, chiestaIl: '2026-10-25T09:00:00.000Z' }],
      {
        letta: true,
        giornate: [
          {
            riderId: RIDER,
            remittedAt: giornataRiaperta.remitted_at,
            collectedCents: giornataRiaperta.collected_cents,
            status: giornataRiaperta.status,
          },
        ],
      },
      Date.now(),
    );
    expect(esito.rinviate.map((r) => r.userId)).toEqual([RIDER]);
    expect(esito.daSegnalare).toHaveLength(0);
  });
});
