import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BIN_POSTGRES, avviaPostgres, type Postgres } from './postgres-usa-e-getta';

/**
 * L'INTERRUTTORE SULL'ORDINE NON SI ACCENDE DA FUORI.
 *
 * Radiografia del 3/9/2026 (rls-database). Il negozio puo' aggiornare i suoi
 * ordini; a tenerlo lontano dai soldi c'e' solo `enforce_order_update_rules`.
 * Quel guardiano si spegneva con una spia di sessione,
 * `mycity.allow_order_write = '1'`, che qualunque ruolo si accende da solo con
 * `set_config` — anche `authenticated`. E `confirm_pickup_by_seller` la
 * accendeva come prima istruzione, prima di sapere chi aveva bussato.
 *
 * La prova gira su un PostgreSQL vero, col guardiano e la funzione del ritiro
 * presi dall'ultima migrazione che li definisce: il negozio con la spia accesa
 * a mano deve restare fermo, mentre le funzioni del database (che girano come
 * il loro proprietario) e il server con la chiave service_role scrivono come
 * prima.
 */

const MIGRAZIONI = join(process.cwd(), 'migrations');
const CORREZIONE = join(MIGRAZIONI, '179_l_interruttore_sull_ordine_non_si_accende_da_fuori.sql');

/** Il testo della funzione dall'ultima migrazione che la definisce. */
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

const NEGOZIO = '00000000-0000-0000-0000-0000000000a1';
const ALTRO_NEGOZIO = '00000000-0000-0000-0000-0000000000a2';
const CLIENTE = '00000000-0000-0000-0000-0000000000c1';
const ORDINE = '00000000-0000-0000-0000-000000000001';
const RITIRO_ALTRUI = '00000000-0000-0000-0000-000000000002';
const RITIRO_MIO = '00000000-0000-0000-0000-000000000003';

describe.skipIf(!BIN_POSTGRES)("l'interruttore sull'ordine non si accende da fuori (database vero)", () => {
  let pg: Postgres;

  const comeNegozio = (sql: string, claims = `{"sub":"${NEGOZIO}","role":"authenticated"}`) =>
    pg.psql(`
      BEGIN;
      DO $x$ BEGIN PERFORM set_config('request.jwt.claims', '${claims}', true); END $x$;
      SET LOCAL ROLE authenticated;
      ${sql};
      COMMIT;`);

  const accendeLaSpia = `DO $x$ BEGIN PERFORM set_config('mycity.allow_order_write', '1', true); END $x$`;
  const ordine = (id: string, colonne: string) => pg.psql(`SELECT ${colonne} FROM public.orders WHERE id = '${id}';`);

  beforeAll(() => {
    pg = avviaPostgres();
    pg.psql(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
        $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $f$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $f$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

      CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text);
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $f$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') $f$;
      CREATE FUNCTION public.is_rider_approvato() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;

      CREATE TABLE public.orders (
        id uuid PRIMARY KEY, seller_id uuid, user_id uuid, rider_id uuid,
        total_price numeric, payment_status text, payout_status text, seller_payout_cents int,
        payment_method text, pickup_in_store boolean, delivery_status text, delivered_at timestamptz,
        accepted_at timestamptz, ready_at timestamptz,
        rider_lat float8, rider_lng float8, rider_position_updated_at timestamptz, updated_at timestamptz);
      ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
      CREATE POLICY orders_negozio_legge ON public.orders FOR SELECT TO authenticated USING (seller_id = auth.uid());
      CREATE POLICY orders_negozio_aggiorna ON public.orders FOR UPDATE TO authenticated
        USING (seller_id = auth.uid()) WITH CHECK (seller_id = auth.uid());
      GRANT SELECT, UPDATE ON public.orders TO authenticated, service_role;

      CREATE TABLE public.order_delivery_codes (
        order_id uuid PRIMARY KEY, code text, attempts int NOT NULL DEFAULT 0,
        locked_until timestamptz, verified_at timestamptz);
      CREATE TABLE public.notifications (category text, user_id uuid, title text, body text, link text);
    `);
    pg.psql(ultimaDefinizione('enforce_order_update_rules'));
    pg.psql(ultimaDefinizione('confirm_pickup_by_seller'));
    if (existsSync(CORREZIONE)) pg.psql(readFileSync(CORREZIONE, 'utf8'));
    pg.psql(`
      CREATE TRIGGER trg_enforce_order_update BEFORE UPDATE ON public.orders
        FOR EACH ROW EXECUTE FUNCTION public.enforce_order_update_rules();

      -- Una funzione del database come le ~15 vere: gira come il suo proprietario e accende la spia.
      CREATE FUNCTION public.scrittura_del_database(p_id uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
      BEGIN
        PERFORM set_config('mycity.allow_order_write', '1', true);
        UPDATE public.orders SET payment_status = 'REFUNDED' WHERE id = p_id;
      END $f$;

      INSERT INTO public.orders (id, seller_id, user_id, total_price, payment_status, payout_status,
                                 seller_payout_cents, payment_method, pickup_in_store, delivery_status) VALUES
        ('${ORDINE}', '${NEGOZIO}', '${CLIENTE}', 48.00, 'PENDING', 'PENDING', 4300, 'card', false, 'NEW'),
        ('${RITIRO_ALTRUI}', '${ALTRO_NEGOZIO}', '${CLIENTE}', 20.00, 'PENDING', 'PENDING', 1800, 'cod', true, 'READY'),
        ('${RITIRO_MIO}', '${NEGOZIO}', '${CLIENTE}', 15.00, 'PENDING', 'PENDING', 1350, 'cod', true, 'READY');
      INSERT INTO public.order_delivery_codes (order_id, code) VALUES ('${RITIRO_ALTRUI}', '1111'), ('${RITIRO_MIO}', '2222');
    `);
  }, 60_000);

  afterAll(() => pg?.ferma());

  it('senza spia il negozio non tocca i soldi del suo ordine', () => {
    expect(() => comeNegozio(`UPDATE public.orders SET total_price = 0.01 WHERE id = '${ORDINE}'`)).toThrow(/campo protetto/);
  });

  it('con la spia accesa a mano il negozio resta fermo lo stesso', () => {
    expect(() =>
      comeNegozio(`${accendeLaSpia}; UPDATE public.orders SET total_price = 0.01, payment_status = 'PAID',
                   seller_payout_cents = 999999 WHERE id = '${ORDINE}'`),
    ).toThrow(/campo protetto/);
    expect(ordine(ORDINE, `total_price || '|' || payment_status || '|' || seller_payout_cents`)).toBe('48.00|PENDING|4300');
  });

  it('nemmeno scrivendosi «service_role» nei claims', () => {
    expect(() =>
      comeNegozio(`UPDATE public.orders SET total_price = 0.01 WHERE id = '${ORDINE}'`, `{"sub":"${NEGOZIO}","role":"service_role"}`),
    ).toThrow(/campo protetto/);
  });

  it('il negozio fa ancora i suoi passi, le funzioni del database e il server scrivono come prima', () => {
    comeNegozio(`UPDATE public.orders SET delivery_status = 'ACCEPTED', accepted_at = now() WHERE id = '${ORDINE}'`);
    expect(ordine(ORDINE, 'delivery_status')).toBe('ACCEPTED');

    comeNegozio(`SELECT public.scrittura_del_database('${ORDINE}')`);
    expect(ordine(ORDINE, 'payment_status')).toBe('REFUNDED');

    pg.psql(`
      BEGIN;
      DO $x$ BEGIN PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); END $x$;
      SET LOCAL ROLE service_role;
      UPDATE public.orders SET seller_payout_cents = 4200 WHERE id = '${ORDINE}';
      COMMIT;`);
    expect(ordine(ORDINE, 'seller_payout_cents')).toBe('4200');
  });

  it('il ritiro rifiutato non lascia la spia accesa', () => {
    const uscita = comeNegozio(
      `SELECT public.confirm_pickup_by_seller('${RITIRO_ALTRUI}', '1111');
       SELECT 'spia=' || coalesce(current_setting('mycity.allow_order_write', true), '')`,
    );
    expect(uscita).toContain('FORBIDDEN');
    expect(uscita.split('\n').pop()).toBe('spia=');
  });

  it('il ritiro giusto chiude ancora l\'ordine', () => {
    expect(comeNegozio(`SELECT public.confirm_pickup_by_seller('${RITIRO_MIO}', '2222')`)).toContain('"ok": true');
    expect(ordine(RITIRO_MIO, `delivery_status || '|' || payment_status || '|' || payout_status`)).toBe('DELIVERED|PAID|CASH_IN_STORE');
  });
});
