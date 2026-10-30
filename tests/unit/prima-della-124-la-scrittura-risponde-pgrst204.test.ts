import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CAMPI_124, conRipiegoSchema, eSchemaIndietro, senzaCampi } from '@/lib/db/migrazione-124';

/**
 * 30/10/2026 — collaudo dell'ondata 16. Prima della migrazione 124 una LETTURA che chiede
 * `gross_total_cents` arriva a PostgreSQL e torna 42703; una SCRITTURA che la porta no: la ferma
 * prima PostgREST, col suo codice, PGRST204 («Could not find the 'x' column of 'y' in the schema
 * cache»). `eSchemaIndietro` conosceva solo i codici di PostgreSQL, quindi il ripiego delle
 * scritture non scattava mai: dopo un rifiuto il segno dell'annullo cadeva, il ricalcolo del
 * carrello si fermava e la carta rendeva 18 € invece di 16 (e la frutta restava a 13 € invece di 15).
 *
 * PGRST204 vale «schema indietro» SOLO se nomina una colonna che nasce con la 124: un nome sbagliato
 * scritto nel codice resta un errore vero, non una migrazione mancante (la regola del 3/9: si
 * distingue per NOME, mai per famiglia di codice).
 */
const fuoriCache = (colonna: string) => ({
  code: 'PGRST204',
  details: null,
  hint: null,
  message: `Could not find the '${colonna}' column of 'orders' in the schema cache`,
});

describe('prima della 124 una scrittura riceve PGRST204, e il ripiego la riconosce', () => {
  it('PGRST204 su una colonna della 124 è schema indietro', () => {
    expect(eSchemaIndietro(fuoriCache('gross_total_cents'))).toBe(true);
    expect(eSchemaIndietro(fuoriCache('payout_tentativo'))).toBe(true);
    expect(eSchemaIndietro(fuoriCache('rider_payout_tentativo'))).toBe(true);
  });

  it('PGRST204 su un altra colonna, o senza dire quale, resta un errore vero', () => {
    expect(eSchemaIndietro(fuoriCache('colonna_scritta_male'))).toBe(false);
    expect(eSchemaIndietro(fuoriCache('gross_total_cents_bis'))).toBe(false);
    expect(eSchemaIndietro({ code: 'PGRST204' })).toBe(false);
    expect(eSchemaIndietro({ code: 'PGRST204', message: 'Could not find the column in the schema cache' })).toBe(false);
  });

  it('l update con gross_total_cents rifiutato da PostgREST si riscrive senza, una volta sola', async () => {
    const scritture: Array<Record<string, unknown>> = [];
    const scrivi = async (valori: Record<string, unknown>) => {
      scritture.push(valori);
      return 'gross_total_cents' in valori
        ? { data: null, error: fuoriCache('gross_total_cents') }
        : { data: [{ id: 'pane' }], error: null };
    };
    const valori = { delivery_fee_cents: 100, rider_fee_cents: 0, gross_total_cents: 1600, total_price: 16 };
    const esito = await conRipiegoSchema('prova', () => scrivi(valori), () => scrivi(senzaCampi(valori, CAMPI_124)));
    expect(esito.error).toBeNull();
    expect(scritture).toHaveLength(2);
    expect(scritture[1]).toEqual({ delivery_fee_cents: 100, rider_fee_cents: 0, total_price: 16 });
  });
});
