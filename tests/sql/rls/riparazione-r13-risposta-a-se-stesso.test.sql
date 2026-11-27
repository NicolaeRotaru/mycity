-- =============================================================================
-- R13 · Il negozio che risponde alla propria domanda non avvisa se stesso
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: per capire se il negozio rispondeva a una domanda sua, il database
-- guardava answered_by, che manda il browser. Con answered_by vuoto il negozio
-- che rispondeva alla domanda scritta da lui sul suo prodotto si trovava nella
-- campanella «Il negozio ha risposto alla tua domanda».
--
-- Non cerca nomi di trigger o di funzioni: il negozio risponde dal browser
-- (ruolo authenticated) senza answered_by e si guarda la campanella. Senza la
-- correzione e' rossa. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0131200-0000-0000-0000-00000000000a', 'fornaio-r13r@test.it',  '{"role":"seller","full_name":"Mario Fornaio"}'),
  ('e0131200-0000-0000-0000-00000000000b', 'cliente-r13r@test.it',  '{"role":"buyer"}'),
  ('e0131200-0000-0000-0000-00000000000d', 'macellaio-r13r@test.it', '{"role":"seller","full_name":"Gino Macellaio"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane R13r'
 WHERE id = 'e0131200-0000-0000-0000-00000000000a';
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Carne R13r'
 WHERE id = 'e0131200-0000-0000-0000-00000000000d';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status) VALUES
  ('e0131200-1111-0000-0000-000000000001', 'e0131200-0000-0000-0000-00000000000a',
   'Pane casereccio', 'per la prova', 3.50, 10, 'available'),
  ('e0131200-1111-0000-0000-000000000002', 'e0131200-0000-0000-0000-00000000000d',
   'Salsiccia', 'per la prova', 6.00, 10, 'available');

-- Le domande le scrive il database di prova: qui conta la risposta.
--   1: il fornaio chiede sul SUO prodotto (es. una domanda frequente scritta da lui)
--   2: il cliente chiede sul prodotto del fornaio
--   3: il fornaio chiede sul prodotto del macellaio (un altro negozio)
--   4: il fornaio chiede ancora sul suo prodotto
INSERT INTO public.product_questions (id, product_id, author_id, question) VALUES
  ('e0131200-2222-0000-0000-000000000001', 'e0131200-1111-0000-0000-000000000001',
   'e0131200-0000-0000-0000-00000000000a', 'Si puo'' congelare?'),
  ('e0131200-2222-0000-0000-000000000002', 'e0131200-1111-0000-0000-000000000001',
   'e0131200-0000-0000-0000-00000000000b', 'È senza glutine?'),
  ('e0131200-2222-0000-0000-000000000003', 'e0131200-1111-0000-0000-000000000002',
   'e0131200-0000-0000-0000-00000000000a', 'È di maiale nostrano?'),
  ('e0131200-2222-0000-0000-000000000004', 'e0131200-1111-0000-0000-000000000001',
   'e0131200-0000-0000-0000-00000000000a', 'Quanto dura fuori dal frigo?');

RESET mycity.allow_profile_write;

-- Aiuto: un negozio risponde dal browser, col suo account. answered_by e' quello
-- che manda il browser: NULL quando il profilo non e' ancora arrivato.
CREATE OR REPLACE FUNCTION pg_temp.rispondi(p_chi uuid, p_domanda uuid, p_testo text, p_answered_by uuid)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_chi, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.product_questions
     SET answer = p_testo, answered_at = now(), answered_by = p_answered_by
   WHERE id = p_domanda;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN CASE WHEN n = 1 THEN 'ok' ELSE 'righe ' || n END;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- Le voci «ha risposto» nella campanella di qualcuno: ogni controllo guarda quante ne arrivano
-- con la SUA risposta (dopo meno prima), non il totale.
CREATE OR REPLACE FUNCTION pg_temp.risposte(p_chi uuid) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications
   WHERE user_id = p_chi AND title = 'Il negozio ha risposto alla tua domanda';
$$;

-- ── ① Il negozio risponde alla sua domanda SENZA answered_by: niente campanella a se stesso
DO $$
DECLARE e text; n int; prima int;
BEGIN
  prima := pg_temp.risposte('e0131200-0000-0000-0000-00000000000a');
  e := pg_temp.rispondi('e0131200-0000-0000-0000-00000000000a', 'e0131200-2222-0000-0000-000000000001',
                        'Sì, fino a un mese.', NULL);
  n := pg_temp.risposte('e0131200-0000-0000-0000-00000000000a') - prima;
  INSERT INTO esiti VALUES ('1 il negozio che risponde alla sua domanda senza answered_by non avvisa se stesso',
    e = 'ok' AND n = 0,
    format('risposta: %s · voci «ha risposto» nella campanella del negozio: %s (attese 0)', e, n));
END $$;

-- ── ② Anche con answered_by = se stesso (com'era gia') ────────────────────
DO $$
DECLARE e text; n int; prima int;
BEGIN
  prima := pg_temp.risposte('e0131200-0000-0000-0000-00000000000a');
  e := pg_temp.rispondi('e0131200-0000-0000-0000-00000000000a', 'e0131200-2222-0000-0000-000000000004',
                        'Due giorni.', 'e0131200-0000-0000-0000-00000000000a');
  n := pg_temp.risposte('e0131200-0000-0000-0000-00000000000a') - prima;
  INSERT INTO esiti VALUES ('2 con answered_by uguale a se stesso resta muto, come prima',
    e = 'ok' AND n = 0,
    format('risposta: %s · voci «ha risposto» nella campanella del negozio: %s (attese 0)', e, n));
END $$;

-- ── ③ La domanda di un cliente avvisa il cliente anche senza answered_by ──
DO $$
DECLARE e text; n int; prima int;
BEGIN
  prima := pg_temp.risposte('e0131200-0000-0000-0000-00000000000b');
  e := pg_temp.rispondi('e0131200-0000-0000-0000-00000000000a', 'e0131200-2222-0000-0000-000000000002',
                        'Sì, farina di riso.', NULL);
  n := pg_temp.risposte('e0131200-0000-0000-0000-00000000000b') - prima;
  INSERT INTO esiti VALUES ('3 la risposta al cliente senza answered_by avvisa il cliente',
    e = 'ok' AND n = 1,
    format('risposta: %s · voci del cliente: %s (attesa 1)', e, n));
END $$;

-- ── ④ Un negozio che chiede a un ALTRO negozio viene avvisato ─────────────
DO $$
DECLARE e text; n int; prima int;
BEGIN
  prima := pg_temp.risposte('e0131200-0000-0000-0000-00000000000a');
  e := pg_temp.rispondi('e0131200-0000-0000-0000-00000000000d', 'e0131200-2222-0000-0000-000000000003',
                        'Sì, da allevamento della valle.', NULL);
  n := pg_temp.risposte('e0131200-0000-0000-0000-00000000000a') - prima;
  INSERT INTO esiti VALUES ('4 il fornaio che chiede al macellaio riceve la risposta del macellaio',
    e = 'ok' AND n = 1,
    format('risposta: %s · voci «ha risposto» del fornaio: %s (attesa 1)', e, n));
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R13 risposte a se stesso: % controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R13 risposte a se stesso: il negozio non avvisa se stesso (% controlli verdi)', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
