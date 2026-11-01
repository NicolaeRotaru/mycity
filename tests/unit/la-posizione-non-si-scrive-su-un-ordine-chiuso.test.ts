import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN_POSTGRES, avviaPostgres, type Postgres } from './postgres-usa-e-getta';

/**
 * LA POSIZIONE DEL FATTORINO NON SI SCRIVE SU UN ORDINE CHIUSO.
 *
 * Il guardiano della 126 azzera la posizione quando l'ordine si chiude, ma
 * scattava solo su UPDATE OF delivery_status: un UPDATE che scrive solo
 * rider_lat/rider_lng su un ordine CANCELED passava (la regola RLS del
 * fattorino esclude solo DELIVERED). Prova su PostgreSQL vero: guardiano e
 * regola come li lasciano 126 e 161, poi la 191 se c'e'.
 */

const MIGRAZIONI = join(process.cwd(), 'migrations');
const CORREZIONE = join(MIGRAZIONI, '191_la_posizione_non_si_scrive_su_un_ordine_chiuso.sql');

/** Funzione e trigger della posizione cosi' come li scrive la 126. */
function guardianoDella126(): string {
  const testo = readFileSync(join(MIGRAZIONI, '126_radiografia_22_agosto.sql'), 'utf8');
  const inizio = testo.indexOf('CREATE OR REPLACE FUNCTION public.cancella_posizione_a_ordine_chiuso()');
  const fineTesto = 'EXECUTE FUNCTION public.cancella_posizione_a_ordine_chiuso();';
  const fine = testo.indexOf(fineTesto, inizio);
  if (inizio < 0 || fine < 0) throw new Error('126: guardiano della posizione non trovato');
  return testo.slice(inizio, fine + fineTesto.length);
}

/** La regola UPDATE del fattorino com'e' nella 161. */
function regolaDelFattorinoDella161(): string {
  const testo = readFileSync(
    join(MIGRAZIONI, '161_quello_che_il_ripasso_del_9_settembre_aveva_riportato_indietro.sql'),
    'utf8',
  );
  const inizio = testo.indexOf('CREATE POLICY "Riders can update assigned or claim free orders"');
  const fine = testo.indexOf(';', inizio);
  if (inizio < 0) throw new Error('161: regola del fattorino non trovata');
  return testo.slice(inizio, fine + 1);
}

const FATTORINO = '00000000-0000-0000-0000-0000000000b1';
const ANNULLATO = '00000000-0000-0000-0000-000000000011';
const IN_CONSEGNA = '00000000-0000-0000-0000-000000000012';
const DA_CHIUDERE = '00000000-0000-0000-0000-000000000013';

describe.skipIf(!BIN_POSTGRES)('la posizione non si scrive su un ordine chiuso (database vero)', () => {
  let pg: Postgres;

  const comeFattorino = (sql: string) =>
    pg.psql(`
      BEGIN;
      DO $x$ BEGIN PERFORM set_config('request.jwt.claims', '{"sub":"${FATTORINO}","role":"authenticated"}', true); END $x$;
      SET LOCAL ROLE authenticated;
      ${sql};
      COMMIT;`);
  const posizione = (id: string) =>
    pg.psql(`SELECT coalesce(rider_lat::text, 'vuota') || '|' || coalesce(rider_lng::text, 'vuota') || '|'
             || coalesce(rider_position_updated_at::text, 'vuota') FROM public.orders WHERE id = '${id}';`);

  beforeAll(() => {
    pg = avviaPostgres();
    pg.psql(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $f$ SELECT nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid $f$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;
      CREATE FUNCTION public.is_rider_approvato() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;

      CREATE TABLE public.orders (
        id uuid PRIMARY KEY, rider_id uuid, delivery_status text,
        rider_lat float8, rider_lng float8, rider_position_updated_at timestamptz);
      ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fattorino_legge ON public.orders FOR SELECT TO authenticated USING (rider_id = auth.uid());
      GRANT SELECT, UPDATE ON public.orders TO authenticated;
    `);
    pg.psql(regolaDelFattorinoDella161());
    pg.psql(guardianoDella126());
    pg.psql(`
      INSERT INTO public.orders (id, rider_id, delivery_status) VALUES
        ('${ANNULLATO}', '${FATTORINO}', 'CANCELED'),
        ('${IN_CONSEGNA}', '${FATTORINO}', 'PICKED_UP'),
        ('${DA_CHIUDERE}', '${FATTORINO}', 'PICKED_UP');
    `);
    if (existsSync(CORREZIONE)) pg.psql(readFileSync(CORREZIONE, 'utf8'));
  }, 60_000);

  afterAll(() => pg?.ferma());

  it('il fattorino non lascia la sua posizione su un ordine annullato', () => {
    comeFattorino(
      `UPDATE public.orders SET rider_lat = 45.05, rider_lng = 9.69, rider_position_updated_at = now()
        WHERE id = '${ANNULLATO}'`,
    );
    expect(posizione(ANNULLATO)).toBe('vuota|vuota|vuota');
  });

  it('nemmeno scrivendo una colonna sola', () => {
    comeFattorino(`UPDATE public.orders SET rider_lng = 9.69 WHERE id = '${ANNULLATO}'`);
    expect(posizione(ANNULLATO)).toBe('vuota|vuota|vuota');
  });

  it("nemmeno scrivendo solo l'ora della posizione", () => {
    comeFattorino(`UPDATE public.orders SET rider_position_updated_at = now() WHERE id = '${ANNULLATO}'`);
    expect(posizione(ANNULLATO)).toBe('vuota|vuota|vuota');
  });

  it('su un ordine in consegna la posizione si scrive ancora', () => {
    comeFattorino(
      `UPDATE public.orders SET rider_lat = 45.05, rider_lng = 9.69, rider_position_updated_at = '2026-11-01 10:00+00'
        WHERE id = '${IN_CONSEGNA}'`,
    );
    expect(posizione(IN_CONSEGNA)).toMatch(/^45\.05\|9\.69\|2026-11-01/);
  });

  it("quando l'ordine si chiude la posizione sparisce come prima", () => {
    pg.psql(`UPDATE public.orders SET rider_lat = 45.05, rider_lng = 9.69, rider_position_updated_at = now()
              WHERE id = '${DA_CHIUDERE}'`);
    pg.psql(`UPDATE public.orders SET delivery_status = 'CANCELED' WHERE id = '${DA_CHIUDERE}'`);
    expect(posizione(DA_CHIUDERE)).toBe('vuota|vuota|vuota');
  });
});
