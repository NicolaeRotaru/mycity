import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BIN_POSTGRES, avviaPostgres, type Postgres } from './postgres-usa-e-getta';

/**
 * IL BUONO REGALO SEGUE IL SUO PAGAMENTO.
 *
 * Un buono regalo nasce da un pagamento con carta. Quando quel pagamento torna
 * indietro — un rimborso, o una contestazione in banca — il buono deve
 * spegnersi con lui: niente riscatto, e il credito che aveva gia' generato si
 * riprende dal portafoglio, con una riga a diario.
 *
 * La prova gira su un PostgreSQL vero, con le funzioni del credito e del
 * riscatto prese dall'ultima migrazione che le definisce. Il server comunica
 * il pagamento tornato indietro con `gift_card_void_for_payment`: dove quella
 * strada non esiste, il database non lo sa e il buono resta com'era — ed e'
 * proprio quello che la prova deve vedere cadere.
 */

const MIGRAZIONI = join(process.cwd(), 'migrations');
const ANNULLO = join(MIGRAZIONI, '178_falla_r83.sql');

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

const CHI_RISCATTA = '00000000-0000-0000-0000-00000000000a';
const CHI_RISCATTA_E_SPENDE = '00000000-0000-0000-0000-00000000000b';

describe.skipIf(!BIN_POSTGRES)('il buono regalo segue il suo pagamento (database vero)', () => {
  let pg: Postgres;

  const comeUtente = (uid: string, sql: string) =>
    pg.psql(`
      BEGIN;
      DO $x$ BEGIN PERFORM set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true); END $x$;
      SET LOCAL ROLE authenticated;
      ${sql};
      COMMIT;`);

  /** Il server dice al database che il pagamento e' tornato indietro. */
  const pagamentoTornatoIndietro = (sessione: string | null, pagamento: string | null, motivo: string): string => {
    const arg = (v: string | null) => (v === null ? 'NULL' : `'${v}'`);
    try {
      return pg.psql(`SELECT public.gift_card_void_for_payment(${arg(sessione)}, ${arg(pagamento)}, '${motivo}');`);
    } catch (e) {
      // Senza questa strada il database non viene a saperlo: il buono resta com'era.
      if (/gift_card_void_for_payment.*does not exist/.test((e as Error).message)) return '';
      throw e;
    }
  };

  const saldo = (uid: string) =>
    Number(pg.psql(`SELECT wallet_balance_cents FROM public.profiles WHERE id = '${uid}';`));

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

      -- 087: il credito sul profilo e il suo diario; 143: la chiave del diario.
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY,
        wallet_balance_cents int NOT NULL DEFAULT 0 CHECK (wallet_balance_cents >= 0));
      CREATE TABLE public.wallet_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.profiles(id),
        delta_cents int NOT NULL, reason text NOT NULL, ref text,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX wallet_ledger_chiave_idx ON public.wallet_ledger (reason, ref)
        WHERE ref IS NOT NULL AND reason <> 'loyalty_convert';

      -- 030 + 103 + 119: il buono regalo com'e' in produzione.
      CREATE TABLE public.gift_cards (
        code text PRIMARY KEY,
        amount_cents int NOT NULL CHECK (amount_cents > 0),
        balance_cents int NOT NULL,
        buyer_id uuid, recipient_email text, recipient_name text, message text,
        redeemed_by uuid REFERENCES public.profiles(id), redeemed_at timestamptz,
        expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 years'),
        created_at timestamptz NOT NULL DEFAULT now(),
        stripe_session_id text,
        CONSTRAINT gift_cards_balance_non_negative CHECK (balance_cents >= 0),
        CONSTRAINT gift_cards_balance_within_amount CHECK (balance_cents <= amount_cents));
      CREATE UNIQUE INDEX gift_cards_stripe_session_idx ON public.gift_cards (stripe_session_id)
        WHERE stripe_session_id IS NOT NULL;
    `);
    for (const nome of ['_wallet_apply', 'wallet_credit', 'wallet_debit', 'redeem_gift_card']) {
      pg.psql(ultimaDefinizione(nome));
    }
    if (existsSync(ANNULLO)) pg.psql(readFileSync(ANNULLO, 'utf8'));
    pg.psql(`
      INSERT INTO public.profiles (id) VALUES ('${CHI_RISCATTA}'), ('${CHI_RISCATTA_E_SPENDE}');
      INSERT INTO public.gift_cards (code, amount_cents, balance_cents, stripe_session_id) VALUES
        ('BUONO-RIMBORSATO', 5000, 5000, 'cs_rimborsato'),
        ('BUONO-CONTESTATO', 5000, 5000, 'cs_contestato'),
        ('BUONO-BUONO', 2500, 2500, 'cs_buono');
    `);
  }, 60_000);

  afterAll(() => pg?.ferma());

  it('il buono col pagamento rimborsato non si riscatta piu\'', () => {
    pagamentoTornatoIndietro('cs_rimborsato', null, 'refunded');
    expect(() => comeUtente(CHI_RISCATTA, `SELECT public.redeem_gift_card('BUONO-RIMBORSATO')`)).toThrow(
      /non più valida/,
    );
    expect(saldo(CHI_RISCATTA)).toBe(0);
    expect(pg.psql(`SELECT balance_cents || '|' || void_reason || '|' || voided_cents FROM public.gift_cards WHERE code = 'BUONO-RIMBORSATO';`)).toBe(
      '0|refunded|5000',
    );
  });

  it('il buono gia\' riscattato e poi contestato riprende il credito che resta, una volta sola', () => {
    comeUtente(CHI_RISCATTA_E_SPENDE, `SELECT public.redeem_gift_card('BUONO-CONTESTATO')`);
    pg.psql(`SELECT public.wallet_debit('${CHI_RISCATTA_E_SPENDE}', 2000, 'order_card', 'ordine-1');`);
    expect(saldo(CHI_RISCATTA_E_SPENDE)).toBe(3000);

    const esito = pagamentoTornatoIndietro('cs_contestato', null, 'disputed');
    expect(saldo(CHI_RISCATTA_E_SPENDE)).toBe(0);
    expect(JSON.parse(esito)).toMatchObject({ esito: 'annullato', dal_credito_cents: 3000, non_recuperati_cents: 2000 });

    // Stripe riconsegna lo stesso evento: niente si muove una seconda volta.
    expect(JSON.parse(pagamentoTornatoIndietro('cs_contestato', null, 'disputed'))).toMatchObject({ esito: 'gia_annullato' });
    expect(saldo(CHI_RISCATTA_E_SPENDE)).toBe(0);
    expect(pg.psql(`SELECT count(*) || '|' || sum(delta_cents) FROM public.wallet_ledger WHERE reason = 'gift_card_void' AND ref = 'BUONO-CONTESTATO';`)).toBe(
      '1|-3000',
    );
  });

  it('si trova anche dal pagamento, e un pagamento sconosciuto non annulla niente', () => {
    pg.psql(`UPDATE public.gift_cards SET stripe_payment_intent = 'pi_buono' WHERE code = 'BUONO-BUONO';`);
    expect(JSON.parse(pagamentoTornatoIndietro(null, 'pi_sconosciuto', 'refunded'))).toMatchObject({ esito: 'non_trovato' });
    expect(pg.psql(`SELECT balance_cents FROM public.gift_cards WHERE code = 'BUONO-BUONO';`)).toBe('2500');
    pagamentoTornatoIndietro(null, 'pi_buono', 'refunded');
    expect(pg.psql(`SELECT balance_cents || '|' || void_reason FROM public.gift_cards WHERE code = 'BUONO-BUONO';`)).toBe('0|refunded');
  });

  it('il pagamento tornato indietro prima che il buono nasca: il buono nasce spento', () => {
    // Stripe non garantisce l'ordine degli eventi: il ritorno del pagamento
    // puo' arrivare prima della nascita del buono (un tentativo caduto e ripetuto).
    const nasce = (codice: string, importo: number, pagamento: string) =>
      pg.psql(`INSERT INTO public.gift_cards (code, amount_cents, balance_cents, stripe_session_id, stripe_payment_intent)
               VALUES ('${codice}', ${importo}, ${importo}, 'cs_${pagamento}', '${pagamento}');`);
    const stato = (codice: string) =>
      pg.psql(`SELECT balance_cents || '|' || coalesce(void_reason, '-') || '|' || coalesce(voided_cents, 0) FROM public.gift_cards WHERE code = '${codice}';`);

    expect(JSON.parse(pagamentoTornatoIndietro(null, 'pi_prima_del_buono', 'refunded'))).toMatchObject({ esito: 'non_trovato' });
    // Stripe riconsegna lo stesso evento prima che il buono nasca: niente cambia.
    pagamentoTornatoIndietro(null, 'pi_prima_del_buono', 'refunded');
    nasce('BUONO-NATO-TARDI', 4000, 'pi_prima_del_buono');
    expect(stato('BUONO-NATO-TARDI')).toBe('0|refunded|4000');
    expect(() => comeUtente(CHI_RISCATTA, `SELECT public.redeem_gift_card('BUONO-NATO-TARDI')`)).toThrow(/non più valida/);
    expect(JSON.parse(pagamentoTornatoIndietro(null, 'pi_prima_del_buono', 'refunded'))).toMatchObject({ esito: 'gia_annullato' });

    pagamentoTornatoIndietro(null, 'pi_contestato_prima', 'disputed');
    nasce('BUONO-CONTESTATO-PRIMA', 3000, 'pi_contestato_prima');
    expect(stato('BUONO-CONTESTATO-PRIMA')).toBe('0|disputed|3000');

    // Un pagamento mai tornato indietro: il buono nasce vivo.
    nasce('BUONO-VIVO', 1500, 'pi_vivo');
    expect(stato('BUONO-VIVO')).toBe('1500|-|0');
    expect(saldo(CHI_RISCATTA)).toBe(0);
  });

  it('dal browser l\'annullo non si chiama', () => {
    expect(() =>
      comeUtente(CHI_RISCATTA, `SELECT public.gift_card_void_for_payment('cs_buono', NULL, 'refunded')`),
    ).toThrow(/permission denied/);
  });
});
