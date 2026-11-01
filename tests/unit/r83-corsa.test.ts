import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BIN_POSTGRES, avviaPostgres, type Postgres } from './postgres-usa-e-getta';

/**
 * R83 — la nascita del buono col pagamento prende la serratura del pagamento.
 *
 * Su un PostgreSQL vero, con la funzione del trigger presa dall'ultima
 * migrazione che la definisce: dentro la transazione dell'inserimento deve
 * comparire la serratura consultiva sulla chiave del pagamento. Se la
 * serratura manca, questa prova diventa rossa.
 */

const MIGRAZIONI = join(process.cwd(), 'migrations');

function ultimaDefinizione(nome: string): string {
  const intestazione = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  const file = readdirSync(MIGRAZIONI)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(MIGRAZIONI, f), 'utf8').includes(intestazione))
    .pop();
  if (!file) throw new Error(`nessuna migrazione definisce ${nome}`);
  const testo = readFileSync(join(MIGRAZIONI, file), 'utf8');
  const dopo = testo.slice(testo.lastIndexOf(intestazione));
  const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(dopo)?.[1];
  if (!tag) throw new Error(`${nome} in ${file}: corpo non trovato`);
  const apre = dopo.indexOf(tag);
  const chiude = dopo.indexOf(tag, apre + tag.length);
  return dopo.slice(0, dopo.indexOf(';', chiude) + 1);
}

describe.skipIf(!BIN_POSTGRES)('R83 corsa (database vero)', () => {
  let pg: Postgres;

  beforeAll(() => {
    pg = avviaPostgres();
    pg.psql(`
      CREATE TABLE public.gift_cards (
        code text PRIMARY KEY,
        stripe_payment_intent text,
        amount_cents int NOT NULL,
        balance_cents int NOT NULL,
        voided_cents int,
        voided_at timestamptz,
        void_reason text
      );
      CREATE TABLE public.gift_card_pending_voids (
        stripe_payment_intent text PRIMARY KEY,
        void_reason text NOT NULL
      );
      ${ultimaDefinizione('gift_card_apply_pending_void')}
      CREATE TRIGGER gift_cards_apply_pending_void
        BEFORE INSERT ON public.gift_cards
        FOR EACH ROW EXECUTE FUNCTION public.gift_card_apply_pending_void();
    `);
  });

  afterAll(() => pg?.ferma());

  /** Serrature consultive tenute da questa sessione subito dopo l'inserimento. */
  const serratureDopoInserimento = (code: string, pagamento: string | null): string[] =>
    pg
      .psql(`
        BEGIN;
        INSERT INTO public.gift_cards (code, stripe_payment_intent, amount_cents, balance_cents)
          VALUES ('${code}', ${pagamento === null ? 'NULL' : `'${pagamento}'`}, 2000, 2000);
        SELECT ((classid::bigint << 32) | objid::bigint)::text
          FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();
        COMMIT;`)
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => /^-?\d+$/.test(r));

  it('il buono col pagamento nasce sotto la serratura del suo pagamento', () => {
    const atteso = pg.psql(`SELECT hashtext('gift_card_payment:pi_corsa')::bigint::text;`).trim();
    const prese = serratureDopoInserimento('MC-CORSA1', 'pi_corsa');
    expect(prese, 'il trigger non prende la serratura: annullo e nascita possono incrociarsi').toContain(atteso);
  });

  it('il buono nato dopo il pagamento tornato indietro nasce spento', () => {
    pg.psql(`INSERT INTO public.gift_card_pending_voids VALUES ('pi_tornato', 'refund');`);
    serratureDopoInserimento('MC-CORSA2', 'pi_tornato');
    expect(pg.psql(`SELECT balance_cents, voided_at IS NOT NULL FROM public.gift_cards WHERE code = 'MC-CORSA2';`).trim()).toMatch(/^0\|t$/);
  });
});
