-- =============================================================================
-- R02-002 — Il carrello in contanti ha la sua chiave sugli ordini
--           (orders.carrello_contanti, migrations/640)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere (Postgres usa e getta):
--   tests/sql/harness/apply.sh mycity_test
--   psql -X -v ON_ERROR_STOP=1 -d mycity_test -f tests/sql/rls/riparazione-r02-carrello-contanti.test.sql
--
-- Maria ordina in contanti pane e frutta in un invio solo (chiave «k-maria-1»), poi il latte in un
-- altro invio («k-maria-2»). Luca, per caso, ha un ordine con la stessa chiave del primo carrello
-- di Maria. Si prova che:
--   ① la colonna c'è, è testo e resta vuota se nessuno la scrive (la carta, gli ordini di prima);
--   ② c'è l'indice (user_id, carrello_contanti), solo sugli ordini con la chiave;
--   ③ la ricerca del codice (stesso cliente, stessa chiave) trova pane e frutta, non il latte
--      dell'altro invio né l'ordine di Luca;
--   ④ il browser non la scrive (il guardiano degli ordini, 179), il server sì.
-- Le istruzioni che nominano la colonna passano da EXECUTE: senza la 640 il controllo dice
-- «NO» con il motivo, invece di fermarsi al primo errore di sintassi.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e6400000-0000-0000-0000-000000000001', 'forno-r02-002@test.it',  '{"role":"seller"}'),
  ('e6400000-0000-0000-0000-000000000002', 'frutta-r02-002@test.it', '{"role":"seller"}'),
  ('e6400000-0000-0000-0000-000000000003', 'maria-r02-002@test.it',  '{"role":"buyer"}'),
  ('e6400000-0000-0000-0000-000000000004', 'luca-r02-002@test.it',   '{"role":"buyer"}');

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status, delivery_status,
  delivery_fee_cents, rider_fee_cents, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e6400000-0000-0000-0000-0000000000a1', 'e6400000-0000-0000-0000-000000000003', 'e6400000-0000-0000-0000-000000000001',
   18, 1800, 'cod', 'PENDING', 'NEW', 300, 300, 'Maria', '333', 'Via A 1', 'Piacenza', '29121'),
  ('e6400000-0000-0000-0000-0000000000a2', 'e6400000-0000-0000-0000-000000000003', 'e6400000-0000-0000-0000-000000000002',
   13, 1300, 'cod', 'PENDING', 'NEW', 100, 100, 'Maria', '333', 'Via A 1', 'Piacenza', '29121'),
  ('e6400000-0000-0000-0000-0000000000a3', 'e6400000-0000-0000-0000-000000000003', 'e6400000-0000-0000-0000-000000000002',
   12, 1200, 'cod', 'PENDING', 'NEW', 300, 300, 'Maria', '333', 'Via A 1', 'Piacenza', '29121'),
  ('e6400000-0000-0000-0000-0000000000b1', 'e6400000-0000-0000-0000-000000000004', 'e6400000-0000-0000-0000-000000000001',
   16, 1600, 'cod', 'PENDING', 'NEW', 300, 300, 'Luca', '334', 'Via B 2', 'Piacenza', '29121'),
  ('e6400000-0000-0000-0000-0000000000c1', 'e6400000-0000-0000-0000-000000000003', 'e6400000-0000-0000-0000-000000000001',
   20, 2000, 'card', 'PAID', 'NEW', 300, 300, 'Maria', '333', 'Via A 1', 'Piacenza', '29121');

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- ① La colonna.
INSERT INTO esiti
SELECT '1a la colonna carrello_contanti c è, testo, e può restare vuota',
       count(*) = 1 AND bool_and(data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL),
       coalesce(string_agg(data_type || ' nullable=' || is_nullable || ' default=' || coalesce(column_default, '—'), '; '), 'colonna assente')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'carrello_contanti';

-- ② L'indice della ricerca.
INSERT INTO esiti
SELECT '2a l indice (user_id, carrello_contanti) c è, solo sugli ordini con la chiave',
       count(*) = 1
         AND bool_and(indexdef ILIKE '%(user_id, carrello_contanti)%' AND indexdef ILIKE '%WHERE (carrello_contanti IS NOT NULL)%'),
       coalesce(string_agg(indexdef, '; '), 'indice assente')
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'orders' AND indexdef ILIKE '%carrello_contanti%';

-- La cassa in contanti scrive la chiave (come service_role, la rotta dei contanti).
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE dettaglio text := 'scritta';
BEGIN
  BEGIN
    EXECUTE $q$UPDATE public.orders SET carrello_contanti = 'k-maria-1'
                WHERE id IN ('e6400000-0000-0000-0000-0000000000a1', 'e6400000-0000-0000-0000-0000000000a2',
                             'e6400000-0000-0000-0000-0000000000b1')$q$;
    EXECUTE $q$UPDATE public.orders SET carrello_contanti = 'k-maria-2'
                WHERE id = 'e6400000-0000-0000-0000-0000000000a3'$q$;
  EXCEPTION WHEN OTHERS THEN dettaglio := SQLSTATE || ' ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('4a il server scrive la chiave del carrello', dettaglio = 'scritta', dettaglio);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- ① bis: chi non la scrive (la carta) resta vuoto.
DO $$
DECLARE vuoti int; dettaglio text;
BEGIN
  BEGIN
    EXECUTE $q$SELECT count(*) FROM public.orders
                WHERE id = 'e6400000-0000-0000-0000-0000000000c1' AND carrello_contanti IS NULL$q$ INTO vuoti;
    dettaglio := vuoti || ' righe vuote';
  EXCEPTION WHEN OTHERS THEN vuoti := -1; dettaglio := SQLSTATE || ' ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('1b l ordine con la carta resta senza chiave', vuoti = 1, dettaglio);
END $$;

-- ③ La ricerca del codice: lo stesso cliente, la stessa chiave non vuota.
DO $$
DECLARE trovati text; dettaglio text;
BEGIN
  BEGIN
    EXECUTE $q$SELECT string_agg(right(id::text, 2), ',' ORDER BY id) FROM public.orders
                WHERE user_id = 'e6400000-0000-0000-0000-000000000003' AND carrello_contanti = 'k-maria-1'$q$ INTO trovati;
    dettaglio := coalesce(trovati, 'nessuno');
  EXCEPTION WHEN OTHERS THEN trovati := NULL; dettaglio := SQLSTATE || ' ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('3a il carrello di Maria è pane e frutta: non il latte dell altro invio, non l ordine di Luca',
                            trovati IS NOT DISTINCT FROM 'a1,a2', dettaglio);
END $$;

-- ④ Il browser non la scrive: né Maria sul suo ordine, né il negozio sull'ordine che ha ricevuto.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e6400000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE codice text := 'nessun errore';
BEGIN
  BEGIN
    EXECUTE $q$UPDATE public.orders SET carrello_contanti = 'k-falsa'
                WHERE id = 'e6400000-0000-0000-0000-0000000000a3'$q$;
  EXCEPTION WHEN OTHERS THEN codice := SQLSTATE;
  END;
  -- Il cliente l'ordine non lo aggiorna proprio (RLS: niente toccato) o lo ferma il guardiano (42501).
  INSERT INTO esiti VALUES ('4b il cliente non cambia la chiave dal browser', codice IN ('42501', 'nessun errore'), codice);
END $$;
RESET ROLE;
RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e6400000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE codice text := 'nessun errore';
BEGIN
  BEGIN
    EXECUTE $q$UPDATE public.orders SET carrello_contanti = 'k-maria-1'
                WHERE id = 'e6400000-0000-0000-0000-0000000000a3'$q$;
  EXCEPTION WHEN OTHERS THEN codice := SQLSTATE;
  END;
  -- Il negozio può trovare l'ordine (RLS) ma non la colonna: 42501 dal guardiano, o niente toccato.
  INSERT INTO esiti VALUES ('4c il negozio non sposta un ordine in un altro carrello', codice IN ('42501', 'nessun errore'), codice);
END $$;
RESET ROLE;
RESET request.jwt.claims;

DO $$
DECLARE chiave text; dettaglio text;
BEGIN
  BEGIN
    EXECUTE $q$SELECT carrello_contanti FROM public.orders WHERE id = 'e6400000-0000-0000-0000-0000000000a3'$q$ INTO chiave;
    dettaglio := coalesce(chiave, 'vuota');
  EXCEPTION WHEN OTHERS THEN chiave := NULL; dettaglio := SQLSTATE || ' ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('4d dopo i tentativi del browser il latte ha ancora la sua chiave', chiave IS NOT DISTINCT FROM 'k-maria-2', dettaglio);
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
    RAISE EXCEPTION 'R02-002: % controllo/i rosso/i sulla chiave del carrello in contanti', rossi;
  END IF;
  RAISE INFO 'R02-002: % controlli verdi sulla chiave del carrello in contanti', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
