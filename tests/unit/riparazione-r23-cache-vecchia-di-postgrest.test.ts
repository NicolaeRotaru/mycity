import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CAMPI_124, conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';

/**
 * R23-003 — Il codice PGRST204 su una colonna della 124 faceva scattare il ripiego per tutti: con
 * la memoria dello schema di PostgREST vecchia, la scrittura saltava `gross_total_cents` anche a
 * migrazione applicata.
 *
 * PGRST204 lo dice PostgREST guardando la SUA memoria dello schema, non il database. Le due
 * situazioni rispondono uguale alla scrittura; le distingue una lettura, che arriva a PostgreSQL:
 *  · migrazione applicata, memoria vecchia → la lettura della colonna riesce → niente ripiego;
 *  · migrazione non applicata → la lettura risponde 42703 → ripiego, come prima.
 *
 * La richiesta finta ha la forma di quella di supabase-js (url, intestazioni, fetch) ed è
 * «thenable» come lei: nessun database vero.
 */

const fuoriCache = {
  code: 'PGRST204',
  details: null,
  hint: null,
  message: "Could not find the 'gross_total_cents' column of 'orders' in the schema cache",
};

type Chiamata = { url: string; method?: string; headers: Headers };
let letture: Chiamata[] = [];

/** Il database dice com'è davvero lo schema: con o senza la colonna. */
function databaseFinto(haLaColonna: boolean) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    letture.push({ url, method: init?.method, headers: new Headers(init?.headers) });
    return haLaColonna
      ? new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ code: '42703', message: 'column orders.gross_total_cents does not exist' }), { status: 400 });
  });
}

/** Una scrittura PostgREST: PostgREST la ferma se un campo non è nella sua memoria dello schema. */
type Esito = { data: unknown; error: unknown };
function scrittura(valori: Record<string, unknown>, fetchDelDatabase: ReturnType<typeof databaseFinto>, scritte: Array<Record<string, unknown>>): PromiseLike<Esito> {
  const esito: Esito = 'gross_total_cents' in valori ? { data: null, error: fuoriCache } : { data: [{ id: 'o1' }], error: null };
  const richiesta = {
    url: new URL('https://db.test/rest/v1/orders?id=eq.o1&dispute_status=is.null'),
    headers: new Headers({ Prefer: 'return=representation', 'Content-Type': 'application/json', 'Content-Profile': 'public', apikey: 'chiave-finta' }),
    fetch: fetchDelDatabase,
    then(ok?: (v: Esito) => unknown, ko?: (e: unknown) => unknown) {
      scritte.push(valori);
      return Promise.resolve(esito).then(ok, ko);
    },
  };
  return richiesta as unknown as PromiseLike<Esito>;
}

const valori = { delivery_fee_cents: 100, gross_total_cents: 1600, total_price: 16 };

beforeEach(() => {
  letture = [];
});

describe('R23-003 — PGRST204 con la memoria di PostgREST vecchia non fa saltare il lordo', () => {
  it('migrazione applicata, memoria vecchia: la scrittura non si rifà senza gross_total_cents', async () => {
    const db = databaseFinto(true);
    const scritte: Array<Record<string, unknown>> = [];
    const esito = await conRipiegoSchema(
      'prova',
      () => scrittura(valori, db, scritte),
      () => scrittura(senzaCampi(valori, CAMPI_124), db, scritte),
    );
    expect(scritte.map((s) => 'gross_total_cents' in s), 'la riga è finita nel database senza lordo').toEqual([true]);
    expect((esito.error as { code?: string } | null)?.code).toBe('PGRST204');

    // La domanda al database: una lettura della sola colonna, sulla stessa tabella, senza Prefer.
    expect(letture).toHaveLength(1);
    const lettura = new URL(letture[0]!.url);
    expect(lettura.pathname).toBe('/rest/v1/orders');
    expect(lettura.searchParams.get('select')).toBe('gross_total_cents');
    expect(letture[0]!.method).toBe('GET');
    expect(letture[0]!.headers.get('prefer')).toBeNull();
    expect(letture[0]!.headers.get('accept-profile')).toBe('public');
    expect(letture[0]!.headers.get('apikey')).toBe('chiave-finta');
  });

  it('migrazione non applicata: la lettura risponde 42703 e il ripiego scatta, come prima', async () => {
    const db = databaseFinto(false);
    const scritte: Array<Record<string, unknown>> = [];
    const esito = await conRipiegoSchema(
      'prova',
      () => scrittura(valori, db, scritte),
      () => scrittura(senzaCampi(valori, CAMPI_124), db, scritte),
    );
    expect(esito.error).toBeNull();
    expect(scritte).toHaveLength(2);
    expect(scritte[1]).toEqual({ delivery_fee_cents: 100, total_price: 16 });
  });

  it('una richiesta che non si può interrogare (non di PostgREST) ripiega come prima', async () => {
    const scritte: Array<Record<string, unknown>> = [];
    const scrivi = async (v: Record<string, unknown>) => {
      scritte.push(v);
      return 'gross_total_cents' in v ? { data: null, error: fuoriCache } : { data: [{ id: 'o1' }], error: null };
    };
    const esito = await conRipiegoSchema('prova', () => scrivi(valori), () => scrivi(senzaCampi(valori, CAMPI_124)));
    expect(esito.error).toBeNull();
    expect(scritte).toHaveLength(2);
  });
});
