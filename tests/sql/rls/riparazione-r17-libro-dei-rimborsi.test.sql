-- =============================================================================
-- R17-014 — Lo stesso rimborso prenotato due volte conta una volta (migrazione 412)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   psql -X -v ON_ERROR_STOP=1 -d mycity_test -f tests/sql/rls/riparazione-r17-libro-dei-rimborsi.test.sql
--
-- `refundOrder` (lib/stripe/payout.ts) prenota il rimborso con `accumula_rimborso`
-- prima di chiamare Stripe, e lo storna con `storna_rimborso` se Stripe dice di no.
-- Il sito passa la chiave che va a Stripe (`return_<id>`); su un database che la
-- funzione con la chiave non ce l'ha, PostgREST risponde «funzione non trovata» e
-- il sito prenota senza chiave. La prova fa lo stesso (`pg_temp.prenota`,
-- `pg_temp.storna`) e guarda il totale rimborsato dell'ordine:
--   ① lo stesso reso prenotato due volte (due richieste insieme, o un tentativo
--      che riprende quello di prima) segna 20 €, non 40;
--   ② la stessa chiave con un'altra cifra non si somma;
--   ③ lo storno di una chiave che non ha prenotato non toglie il rimborso di un altro;
--   ④ lo storno del tentativo toglie la sua prenotazione, e il tentativo dopo
--      prenota da capo (il rimborso che non era uscito si rifà);
--   ⑤ senza chiave la somma resta quella di prima, e il tetto del lordo tiene.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1740000-0000-0000-0000-000000000001', 'forno-r17-014@test.it', '{"role":"seller"}'),
  ('e1740000-0000-0000-0000-000000000002', 'maria-r17-014@test.it', '{"role":"buyer"}');

-- Sei ordini con la carta da 40 €, consegnati: uno per controllo.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, refunded_amount_cents, payment_method, payment_status,
  delivery_status, delivered_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e1740000-0000-0000-0000-000000000002', 'e1740000-0000-0000-0000-000000000001',
       40, 4000, 0, 'card', 'PAID', 'DELIVERED', now() - interval '1 day',
       'Maria', '333', 'Via A 1', 'Piacenza', '29121'
  FROM (VALUES
    ('e1740000-0000-0000-0000-0000000000a1'),
    ('e1740000-0000-0000-0000-0000000000a2'),
    ('e1740000-0000-0000-0000-0000000000a3'),
    ('e1740000-0000-0000-0000-0000000000a4'),
    ('e1740000-0000-0000-0000-0000000000a5'),
    ('e1740000-0000-0000-0000-0000000000a6')
  ) AS v(id);

RESET mycity.allow_profile_write;
-- `mycity.allow_order_write` resta: le funzioni del libro le chiama il server (la chiave di
-- servizio), e il guardiano degli ordini (enforce_order_update_rules) lascia scrivere solo lui.

-- Come il sito (lib/stripe/payout.ts, prenotaIlRimborso e stornaLaPrenotazione): con la
-- chiave; se il database non ha la funzione con la chiave, senza.
CREATE FUNCTION pg_temp.prenota(o uuid, centesimi int, chiave text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.accumula_rimborso(p_order_id => o, p_delta => centesimi, p_chiave => chiave);
  EXCEPTION WHEN undefined_function THEN
    PERFORM public.accumula_rimborso(p_order_id => o, p_delta => centesimi);
  END;
END $$;

CREATE FUNCTION pg_temp.storna(o uuid, centesimi int, chiave text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.storna_rimborso(p_order_id => o, p_delta => centesimi, p_chiave => chiave);
  EXCEPTION WHEN undefined_function THEN
    PERFORM public.storna_rimborso(p_order_id => o, p_delta => centesimi);
  END;
END $$;

CREATE FUNCTION pg_temp.rimborsato(o uuid) RETURNS int LANGUAGE sql AS $$
  SELECT coalesce(refunded_amount_cents, 0) FROM public.orders WHERE id = o
$$;

-- ① Lo stesso reso, due volte.
DO $$
DECLARE o uuid := 'e1740000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.prenota(o, 2000, 'return_r1');
  PERFORM pg_temp.prenota(o, 2000, 'return_r1');
  INSERT INTO esiti VALUES ('1 lo stesso reso prenotato due volte segna 20 euro, non 40',
    pg_temp.rimborsato(o) = 2000, format('rimborsato %s (atteso 2000)', pg_temp.rimborsato(o)));
END $$;

-- ② La stessa chiave con un'altra cifra.
DO $$
DECLARE o uuid := 'e1740000-0000-0000-0000-0000000000a2';
BEGIN
  PERFORM pg_temp.prenota(o, 2000, 'return_r2');
  PERFORM pg_temp.prenota(o, 1500, 'return_r2');
  INSERT INTO esiti VALUES ('2 la stessa chiave con un''altra cifra non si somma',
    pg_temp.rimborsato(o) = 2000, format('rimborsato %s (atteso 2000)', pg_temp.rimborsato(o)));
END $$;

-- ③ Lo storno di una chiave che non ha prenotato.
DO $$
DECLARE o uuid := 'e1740000-0000-0000-0000-0000000000a3';
BEGIN
  PERFORM pg_temp.prenota(o, 1500, 'return_r3');
  PERFORM pg_temp.storna(o, 1500, 'dispute_d3');
  INSERT INTO esiti VALUES ('3 lo storno di un''altra chiave non toglie il rimborso del reso',
    pg_temp.rimborsato(o) = 1500, format('rimborsato %s (atteso 1500)', pg_temp.rimborsato(o)));
END $$;

-- ④ Lo storno del tentativo, e il tentativo dopo.
DO $$
DECLARE o uuid := 'e1740000-0000-0000-0000-0000000000a4';
BEGIN
  PERFORM pg_temp.prenota(o, 1000, 'return_r4');
  PERFORM pg_temp.storna(o, 1000, 'return_r4');
  INSERT INTO esiti VALUES ('4a lo storno del tentativo toglie la sua prenotazione',
    pg_temp.rimborsato(o) = 0, format('rimborsato %s (atteso 0)', pg_temp.rimborsato(o)));
  PERFORM pg_temp.prenota(o, 1000, 'return_r4');
  INSERT INTO esiti VALUES ('4b dopo lo storno lo stesso rimborso si prenota da capo',
    pg_temp.rimborsato(o) = 1000, format('rimborsato %s (atteso 1000)', pg_temp.rimborsato(o)));
  PERFORM pg_temp.storna(o, 1000, 'return_r4');
  PERFORM pg_temp.storna(o, 1000, 'return_r4');
  INSERT INTO esiti VALUES ('4c uno storno ripetuto non scende sotto quello che c''era',
    pg_temp.rimborsato(o) = 0, format('rimborsato %s (atteso 0)', pg_temp.rimborsato(o)));
END $$;

-- ⑤ Senza chiave, e il tetto del lordo.
DO $$
DECLARE o uuid := 'e1740000-0000-0000-0000-0000000000a5';
BEGIN
  PERFORM public.accumula_rimborso(o, 500);
  PERFORM public.accumula_rimborso(o, 500);
  INSERT INTO esiti VALUES ('5a senza chiave due rimborsi da 5 euro fanno 10 euro, come prima',
    pg_temp.rimborsato(o) = 1000, format('rimborsato %s (atteso 1000)', pg_temp.rimborsato(o)));
  PERFORM public.storna_rimborso(o, 500);
  INSERT INTO esiti VALUES ('5b senza chiave lo storno toglie la cifra, come prima',
    pg_temp.rimborsato(o) = 500, format('rimborsato %s (atteso 500)', pg_temp.rimborsato(o)));
END $$;

DO $$
DECLARE o uuid := 'e1740000-0000-0000-0000-0000000000a6';
BEGIN
  PERFORM pg_temp.prenota(o, 3000, 'return_r6');
  PERFORM pg_temp.prenota(o, 2000, 'dispute_d6');
  INSERT INTO esiti VALUES ('5c con la chiave il tetto del lordo tiene: 30 + 20 su 40 non passa',
    pg_temp.rimborsato(o) = 3000, format('rimborsato %s (atteso 3000)', pg_temp.rimborsato(o)));
  PERFORM pg_temp.prenota(o, 1000, 'dispute_d6');
  INSERT INTO esiti VALUES ('5d la chiave che non era passata col tetto non resta prenotata',
    pg_temp.rimborsato(o) = 4000, format('rimborsato %s (atteso 4000)', pg_temp.rimborsato(o)));
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE r record; rossi int := 0;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    IF r.ok THEN
      RAISE INFO 'ok  %', r.nome;
    ELSE
      rossi := rossi + 1;
      RAISE INFO 'NO  % — %', r.nome, r.dettaglio;
    END IF;
  END LOOP;
  IF rossi > 0 THEN
    RAISE EXCEPTION 'R17-014: % controllo/i rosso/i sul libro dei rimborsi', rossi;
  END IF;
  RAISE INFO 'R17-014: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
