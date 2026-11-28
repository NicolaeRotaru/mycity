-- =============================================================================
-- N-004 (onda 3) — Due spostamenti insieme verso l'ultimo posto della fascia: ne passa uno
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   psql -d mycity_test -f tests/sql/rls/onda3-n004-due-spostamenti-insieme-nella-fascia-piena.test.sql
--
-- La fascia «Domani · 16:30–18:00» ha 4 giri: c'è un posto. Due veloci in contanti di due clienti
-- diversi vengono spostate lì nello stesso istante, da due sessioni vere (due giri del freno della
-- veloce accavallati, o un freno e un amministratore). Il freno conta prima i giri
-- (`rifiutoPerFasciaPiena`), ma fra la lettura e la scrittura non c'è lucchetto: tutti e due leggono
-- «c'è posto». L'ultima parola è del database (onda2_F1_1, anche BEFORE UPDATE OF delivery_slot):
--   ① la sessione B aspetta il lucchetto della sessione A finché A non ha finito;
--   ② A entra nella fascia, B si ferma con 23514 `fascia_piena`;
--   ③ nella fascia restano 5 giri, non 6.
-- Senza la riparazione B non aspetta nessuno, entra anche lui, e la prova è ROSSA.
--
-- Le due sessioni sono connessioni dblink allo stesso database: per vedersi a vicenda i dati di
-- partenza devono essere SCRITTI DAVVERO (commit), quindi questa prova non sta tutta nel ROLLBACK
-- finale: li cancella da sé alla fine, anche se qualcosa va storto, e li cancella anche all'inizio
-- (un giro di prima interrotto). Se dblink non c'è, la prova lo dice e non gira.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'dblink') THEN
    CREATE EXTENSION IF NOT EXISTS dblink;
  END IF;
END $$;

DO $prova$
DECLARE
  fascia   constant text := 'Domani · 16:30–18:00';
  adesso   constant text := 'Adesso · arrivo in 30-60 min';
  veloce_a constant uuid := 'a0041000-0000-0000-0000-0000000000a1';
  veloce_b constant uuid := 'a0041000-0000-0000-0000-0000000000b1';
  dove     text;
  conn     text;
  esito_a  text;
  esito_b  text;
  aspetta  integer;
  giri     integer;
  pulizia  constant text := $q$
    SET mycity.allow_order_write = '1';
    DELETE FROM public.orders WHERE id::text LIKE 'a0041000-%';
    DELETE FROM auth.users   WHERE id::text LIKE 'a0041000-%';
  $q$;
  -- Lo spostamento come lo scrive il freno, in ciascuna sessione: «spostato» o codice e segno del rifiuto.
  aiuto    constant text := $q$
    SET mycity.allow_profile_write = '1';
    SET mycity.allow_order_write   = '1';
    CREATE FUNCTION pg_temp.sposta(p_id uuid, p_da text, p_a text)
    RETURNS text LANGUAGE plpgsql AS $f$
    DECLARE stato text; segno text; righe int;
    BEGIN
      UPDATE public.orders SET delivery_slot = p_a WHERE id = p_id AND delivery_slot IS NOT DISTINCT FROM p_da;
      GET DIAGNOSTICS righe = ROW_COUNT;
      RETURN CASE WHEN righe = 1 THEN 'spostato' ELSE 'nessuna riga' END;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS stato = RETURNED_SQLSTATE, segno = PG_EXCEPTION_HINT;
      RETURN 'fermo ' || stato || ' ' || coalesce(segno, '');
    END $f$;
  $q$;
BEGIN
  IF to_regprocedure('public.dblink_connect(text,text)') IS NULL THEN
    RAISE INFO 'SALTATA  due sessioni insieme: l''estensione dblink non c''è in questo Postgres';
    RETURN;
  END IF;

  dove := nullif(split_part(current_setting('unix_socket_directories'), ',', 1), '');
  conn := format('dbname=%s user=%s port=%s host=%s', quote_literal(current_database()), quote_literal(current_user),
                 current_setting('port'), quote_literal(coalesce(dove, 'localhost')));
  BEGIN
    PERFORM public.dblink_connect('n004_a', conn);
    PERFORM public.dblink_connect('n004_b', conn);
  EXCEPTION WHEN OTHERS THEN
    RAISE INFO 'SALTATA  due sessioni insieme: la seconda connessione al database non si apre (%)', SQLERRM;
    RETURN;
  END;

  BEGIN
    PERFORM public.dblink_exec('n004_a', pulizia);
    PERFORM public.dblink_exec('n004_a', aiuto);
    PERFORM public.dblink_exec('n004_b', aiuto);

    -- I dati di partenza, scritti davvero: 4 porte nella fascia, e due veloci «Adesso» (nascono
    -- senza fascia: la regola del fattorino libero della 840 guarda solo la nascita).
    PERFORM public.dblink_exec('n004_a', format($q$
      INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
        ('a0041000-0000-0000-0000-000000000001', 'forno-n004b@test.it',  '{"role":"seller"}', now()),
        ('a0041000-0000-0000-0000-000000000021', 'anna-n004b@test.it',   '{"role":"buyer"}',  now()),
        ('a0041000-0000-0000-0000-000000000022', 'bruno-n004b@test.it',  '{"role":"buyer"}',  now()),
        ('a0041000-0000-0000-0000-000000000023', 'carla-n004b@test.it',  '{"role":"buyer"}',  now()),
        ('a0041000-0000-0000-0000-000000000024', 'dario-n004b@test.it',  '{"role":"buyer"}',  now()),
        ('a0041000-0000-0000-0000-000000000025', 'elena-n004b@test.it',  '{"role":"buyer"}',  now()),
        ('a0041000-0000-0000-0000-000000000026', 'fabio-n004b@test.it',  '{"role":"buyer"}',  now());
      UPDATE public.profiles
         SET is_approved = true, approval_status = 'approved', store_name = 'Negozio N004b', store_address = 'Via Roma 1, Piacenza'
       WHERE id = 'a0041000-0000-0000-0000-000000000001';
      INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
        delivery_status, pickup_in_store, delivery_slot, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip)
      SELECT v.id::uuid, v.cliente::uuid, 'a0041000-0000-0000-0000-000000000001', 10, 1000, 'cod', 'PENDING',
             'NEW', false, v.fascia, 'Cliente N004b', '3', v.indirizzo, 'Piacenza', '29121'
        FROM (VALUES
          ('a0041000-0000-0000-0000-0000000000c1', 'a0041000-0000-0000-0000-000000000021', %1$L, 'Via Verdi 1'),
          ('a0041000-0000-0000-0000-0000000000c2', 'a0041000-0000-0000-0000-000000000022', %1$L, 'Via Bianchi 2'),
          ('a0041000-0000-0000-0000-0000000000c3', 'a0041000-0000-0000-0000-000000000023', %1$L, 'Via Neri 3'),
          ('a0041000-0000-0000-0000-0000000000c4', 'a0041000-0000-0000-0000-000000000024', %1$L, 'Via Gialli 4'),
          (%2$L, 'a0041000-0000-0000-0000-000000000025', NULL, 'Via Rosa 5'),
          (%3$L, 'a0041000-0000-0000-0000-000000000026', NULL, 'Via Blu 6')
        ) AS v(id, cliente, fascia, indirizzo);
      UPDATE public.orders SET delivery_slot = %4$L WHERE id IN (%2$L, %3$L);
    $q$, fascia, veloce_a, veloce_b, adesso));

    -- A: apre la sua transazione e sposta la veloce di Elena nell'ultimo posto. Non chiude ancora.
    PERFORM public.dblink_exec('n004_a', 'BEGIN');
    SELECT r INTO esito_a FROM public.dblink('n004_a',
      format('SELECT pg_temp.sposta(%L, %L, %L)', veloce_a, adesso, fascia)) AS t(r text);

    -- B: nello stesso momento sposta la veloce di Fabio nella stessa fascia, senza aspettare la risposta.
    PERFORM public.dblink_send_query('n004_b',
      format('SELECT pg_temp.sposta(%L, %L, %L)', veloce_b, adesso, fascia));
    PERFORM pg_sleep(0.5);
    aspetta := public.dblink_is_busy('n004_b');

    -- A finisce: B riparte, vede A nella fascia, e decide.
    PERFORM public.dblink_exec('n004_a', 'COMMIT');
    SELECT r INTO esito_b FROM public.dblink_get_result('n004_b') AS t(r text);
    PERFORM * FROM public.dblink_get_result('n004_b') AS t(r text);

    SELECT n INTO giri FROM public.dblink('n004_a', format($q$
      SELECT count(DISTINCT user_id)::int FROM public.orders WHERE id::text LIKE 'a0041000-%%' AND delivery_slot = %L
    $q$, fascia)) AS t(n int);

    INSERT INTO esiti VALUES
      ('① la seconda sessione aspetta il lucchetto della prima', aspetta = 1, format('in attesa dopo mezzo secondo: %s', aspetta = 1)),
      ('② la prima entra nell ultimo posto', esito_a = 'spostato', esito_a),
      ('② la seconda si ferma col segno per l app', esito_b = 'fermo 23514 fascia_piena', coalesce(esito_b, '(nessuna risposta)')),
      ('③ nella fascia restano 5 giri, non 6', giri = 5, giri || ' giri');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('le due sessioni arrivano in fondo', false, SQLERRM);
  END;

  -- Sempre: via i dati scritti davvero, e via le connessioni.
  BEGIN
    PERFORM public.dblink_exec('n004_a', 'ROLLBACK');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.dblink_exec('n004_a', pulizia);
    SELECT n INTO giri FROM public.dblink('n004_a',
      $q$SELECT count(*)::int FROM public.orders WHERE id::text LIKE 'a0041000-%'$q$) AS t(n int);
    INSERT INTO esiti VALUES ('i dati di prova non restano nel database', giri = 0, giri || ' ordini rimasti');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO esiti VALUES ('i dati di prova non restano nel database', false, SQLERRM);
  END;
  PERFORM public.dblink_disconnect(c) FROM unnest(public.dblink_get_connections()) AS c WHERE c LIKE 'n004_%';
END $prova$;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;
