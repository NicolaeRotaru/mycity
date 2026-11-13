import { describe, it, expect, vi, beforeEach } from 'vitest';

const stato = vi.hoisted(() => ({
  /** Le colonne che il database ha davvero, per tabella: la memoria di PostgREST può non saperlo. */
  schema: {} as Record<string, string[]>,
  letture: [] as Array<{ url: string; chiave: string; tabella: string; colonna: string }>,
}));

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Il client admin del sito, finto: risponde come PostgreSQL, che la memoria di PostgREST non ferma.
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, chiave: string) => ({
    from: (tabella: string) => ({
      select: (colonna: string) => ({
        limit: async () => {
          stato.letture.push({ url, chiave, tabella, colonna });
          return (stato.schema[tabella] ?? []).includes(colonna)
            ? { data: [], error: null }
            : { data: null, error: { code: '42703', message: `column ${tabella}.${colonna} does not exist` } };
        },
      }),
    }),
  }),
}));

import { logger } from '@/lib/logger';
import { CAMPI_124, conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';

/**
 * R23-003 — Il codice PGRST204 su una colonna della 124 faceva scattare il ripiego per tutti: con
 * la memoria dello schema di PostgREST vecchia, la scrittura saltava `gross_total_cents` anche a
 * migrazione applicata.
 *
 * PGRST204 lo dice PostgREST guardando la SUA memoria dello schema, non il database. Le due
 * situazioni rispondono uguale alla scrittura; le distingue una lettura col client admin, che
 * arriva a PostgreSQL:
 *  · migrazione applicata, memoria vecchia → la lettura della colonna riesce → niente ripiego;
 *  · migrazione non applicata → la lettura risponde 42703 → ripiego, come prima.
 *
 * Tabella e colonna vengono dal messaggio del PGRST204, non dalla richiesta: il turno del bonifico
 * al fattorino (lib/stripe/payout.ts) avvolge la scrittura in una funzione, e prima il controllo
 * lì non partiva. Nessun database vero: la memoria vecchia è una scrittura finta che risponde
 * PGRST204, il database è lo schema scritto sopra.
 */

const fuoriCache = (colonna: string, tabella = 'orders') => ({
  code: 'PGRST204',
  details: null,
  hint: null,
  message: `Could not find the '${colonna}' column of '${tabella}' in the schema cache`,
});

type Esito = { data: unknown; error: unknown };

/** Una scrittura come la vede PostgREST con la memoria vecchia: un campo nuovo, e la rifiuta. */
function scrittura(valori: Record<string, unknown>, nuova: string, scritte: Array<Record<string, unknown>>): PromiseLike<Esito> {
  const esito: Esito = nuova in valori ? { data: null, error: fuoriCache(nuova) } : { data: [{ id: 'o1' }], error: null };
  return {
    then(ok?: (v: Esito) => unknown, ko?: (e: unknown) => unknown) {
      scritte.push(valori);
      return Promise.resolve(esito).then(ok, ko);
    },
  } as unknown as PromiseLike<Esito>;
}

const valori = { delivery_fee_cents: 100, gross_total_cents: 1600, total_price: 16 };

beforeEach(() => {
  stato.letture = [];
  stato.schema = { orders: ['id', 'gross_total_cents', 'payout_tentativo', 'rider_payout_tentativo', 'rider_payout_claimed_at'] };
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'chiave-di-servizio');
  vi.mocked(logger.error).mockClear();
});

describe('R23-003 — PGRST204 con la memoria di PostgREST vecchia non fa saltare le colonne della 124', () => {
  it('migrazione applicata, memoria vecchia: la scrittura non si rifà senza gross_total_cents', async () => {
    const scritte: Array<Record<string, unknown>> = [];
    const esito = await conRipiegoSchema(
      'prova',
      () => scrittura(valori, 'gross_total_cents', scritte),
      () => scrittura(senzaCampi(valori, CAMPI_124), 'gross_total_cents', scritte),
    );
    expect(scritte.map((s) => 'gross_total_cents' in s), 'la riga è finita nel database senza lordo').toEqual([true]);
    expect((esito.error as { code?: string } | null)?.code).toBe('PGRST204');

    // La domanda al database: la sola colonna, sulla tabella del messaggio, col client admin del sito.
    expect(stato.letture).toEqual([{ url: 'https://db.test', chiave: 'chiave-di-servizio', tabella: 'orders', colonna: 'gross_total_cents' }]);
    expect(vi.mocked(logger.error).mock.calls.map((c) => String(c[0])).join(' ')).toMatch(/schema vecchio.*reload schema/);
  });

  it('chi avvolge la scrittura in una funzione (il turno del fattorino) non perde rider_payout_claimed_at', async () => {
    const scritte: Array<Record<string, unknown>> = [];
    const turno = { rider_payout_status: 'PROCESSING', rider_payout_claimed_at: '2026-11-13T10:00:00.000Z' };
    // Come prendiIlTurnoDelFattorino in lib/stripe/payout.ts: una funzione async, non la richiesta.
    const prendiIlTurno = async (v: Partial<typeof turno>) => {
      const libero = await scrittura(v, 'rider_payout_claimed_at', scritte);
      return libero;
    };
    const esito = await conRipiegoSchema(
      'orders.update (turno del compenso fattorino)',
      () => prendiIlTurno(turno),
      () => prendiIlTurno(senzaCampi(turno, ['rider_payout_claimed_at'])),
    );
    expect(scritte.map((s) => 'rider_payout_claimed_at' in s), 'il turno è stato preso senza l ora').toEqual([true]);
    expect((esito.error as { code?: string } | null)?.code).toBe('PGRST204');
    expect(stato.letture.map((l) => `${l.tabella}.${l.colonna}`)).toEqual(['orders.rider_payout_claimed_at']);
  });

  it('migrazione non applicata: la lettura risponde 42703 e il ripiego scatta, come prima', async () => {
    stato.schema = { orders: ['id'] };
    const scritte: Array<Record<string, unknown>> = [];
    const esito = await conRipiegoSchema(
      'prova',
      () => scrittura(valori, 'gross_total_cents', scritte),
      () => scrittura(senzaCampi(valori, CAMPI_124), 'gross_total_cents', scritte),
    );
    expect(esito.error).toBeNull();
    expect(scritte).toHaveLength(2);
    expect(scritte[1]).toEqual({ delivery_fee_cents: 100, total_price: 16 });
  });

  it('senza le credenziali del client admin (il browser) non si può chiedere: ripiego come prima', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const scritte: Array<Record<string, unknown>> = [];
    const esito = await conRipiegoSchema(
      'prova',
      () => scrittura(valori, 'gross_total_cents', scritte),
      () => scrittura(senzaCampi(valori, CAMPI_124), 'gross_total_cents', scritte),
    );
    expect(esito.error).toBeNull();
    expect(scritte).toHaveLength(2);
  });
});
