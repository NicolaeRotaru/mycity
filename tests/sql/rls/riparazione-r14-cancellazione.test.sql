-- =============================================================================
-- R14-005 — Chi ha fatto anche un solo ordine riesce a cancellare l'account
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- La cancellazione vera (lib/account/cancellazione.ts, `cancellaAccount`) fa
-- due scritture che toccano gli ordini, con due identita' diverse:
--
--  ② la pulizia dei dati di consegna: PostgREST con la chiave di servizio,
--    cioe' ruolo `service_role` e claims `{"role":"service_role"}`;
--  ③ `admin.auth.admin.deleteUser`: la fa il servizio di autenticazione, col
--    suo ruolo (`supabase_auth_admin`) e SENZA claims. Da li' PostgreSQL
--    cancella il profilo e mette a NULL `orders.user_id` (ON DELETE SET NULL).
--
-- Il guardiano degli ordini (`enforce_order_update_rules`, 179) respingeva il
-- ③: «orders: modifica di un campo protetto non consentita». La prova 31 lo
-- nascondeva scrivendo a mano `role = service_role` nei claims prima del
-- DELETE. Qui il DELETE arriva come arriva davvero.
--
-- E la porta resta chiusa: il negozio (authenticated) e l'anonimo non staccano
-- un ordine dal cliente; la cascata non si porta dietro un cambio di soldi; e
-- nemmeno con il profilo gia' sparito un browser o una scrittura diretta
-- passano.
--
-- Senza la migrazione 382 questa prova e' ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role, supabase_auth_admin;

-- In Supabase il servizio di autenticazione e' il proprietario di `auth.users`.
-- Qui la tabella e' dell'impalcatura: gli si da' quanto serve per cancellare.
GRANT USAGE ON SCHEMA auth TO supabase_auth_admin;
GRANT SELECT, DELETE ON auth.users TO supabase_auth_admin;

-- Maria ha fatto un ordine solo. Luca ne ha fatto un altro e resta.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1400005-0000-4000-8000-000000000001', 'maria.rossi@test.it',     '{"role":"buyer"}'),
  ('a1400005-0000-4000-8000-000000000002', 'pane.quotidiano@test.it', '{"role":"seller"}'),
  ('a1400005-0000-4000-8000-000000000003', 'luca.bianchi@test.it',    '{"role":"buyer"}');

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city,
  delivery_zip, delivery_notes, delivery_lat, delivery_lng
) VALUES
  ('a1400005-0000-4000-8000-0000000000a1',
   'a1400005-0000-4000-8000-000000000001', 'a1400005-0000-4000-8000-000000000002',
   24.50, 'PAID', 'DELIVERED',
   'Maria Rossi', '+39 333 1234567', 'Via Roma 12', 'Piacenza',
   '29121', 'citofono Rossi, secondo piano', 45.0526, 9.6929),
  ('a1400005-0000-4000-8000-0000000000b1',
   'a1400005-0000-4000-8000-000000000003', 'a1400005-0000-4000-8000-000000000002',
   18.00, 'PAID', 'DELIVERED',
   'Luca Bianchi', '+39 333 7654321', 'Via Verdi 3', 'Piacenza',
   '29122', NULL, 45.05, 9.69);

-- =============================================================================
-- ② La pulizia, come la fa il sito: chiave di servizio
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$ BEGIN PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); END $$;
DO $$
DECLARE errore text;
BEGIN
  UPDATE public.orders
     SET delivery_full_name = NULL, delivery_phone = NULL, delivery_address = NULL,
         delivery_zip = NULL, delivery_notes = NULL, delivery_lat = NULL, delivery_lng = NULL
   WHERE user_id = 'a1400005-0000-4000-8000-000000000001';
  INSERT INTO esiti VALUES ('la pulizia con la chiave di servizio passa', true, '');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS errore = MESSAGE_TEXT;
  INSERT INTO esiti VALUES ('la pulizia con la chiave di servizio passa', false, 'respinta: ' || errore);
END $$;
RESET ROLE;

-- =============================================================================
-- ③ deleteUser: il servizio di autenticazione, senza claims e senza spie
-- =============================================================================
DO $$ BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;
DO $$ BEGIN PERFORM set_config('mycity.allow_order_write', '', true); END $$;
SET LOCAL ROLE supabase_auth_admin;
DO $$
DECLARE errore text;
BEGIN
  DELETE FROM auth.users WHERE id = 'a1400005-0000-4000-8000-000000000001';
  INSERT INTO esiti VALUES ('chi ha un ordine si cancella, come lo cancella il servizio di autenticazione', true, '');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS errore = MESSAGE_TEXT;
  INSERT INTO esiti VALUES ('chi ha un ordine si cancella, come lo cancella il servizio di autenticazione', false,
    'respinta: ' || errore || ' — la richiesta resta aperta e ogni notte rifallisce');
END $$;
RESET ROLE;

DO $$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = 'a1400005-0000-4000-8000-0000000000a1';

  INSERT INTO esiti VALUES ('l account e il profilo di Maria non ci sono piu',
    NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'a1400005-0000-4000-8000-000000000001')
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = 'a1400005-0000-4000-8000-000000000001'), '');

  INSERT INTO esiti VALUES ('l ordine resta, staccato dalla persona',
    o.id IS NOT NULL AND o.user_id IS NULL,
    coalesce('user_id = ' || o.user_id::text, 'user_id NULL o ordine assente'));

  INSERT INTO esiti VALUES ('nell ordine restano importo, stato e negozio, senza indirizzo',
    o.total_price = 24.50 AND o.payment_status = 'PAID' AND o.delivery_status = 'DELIVERED'
    AND o.seller_id = 'a1400005-0000-4000-8000-000000000002'
    AND o.delivery_full_name IS NULL AND o.delivery_address IS NULL AND o.delivery_phone IS NULL, '');

  INSERT INTO esiti VALUES ('l ordine di Luca non e toccato',
    (SELECT user_id FROM public.orders WHERE id = 'a1400005-0000-4000-8000-0000000000b1')
      = 'a1400005-0000-4000-8000-000000000003', '');
END $$;

-- =============================================================================
-- La porta resta chiusa ①: il negozio (authenticated) non stacca un ordine
-- =============================================================================
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM set_config('request.jwt.claims',
  '{"sub":"a1400005-0000-4000-8000-000000000002","role":"authenticated"}', true); END $$;
DO $$ BEGIN PERFORM set_config('mycity.allow_order_write', '1', true); END $$; -- la spia accesa dal browser non conta
DO $$
DECLARE errore text;
BEGIN
  UPDATE public.orders SET user_id = NULL WHERE id = 'a1400005-0000-4000-8000-0000000000b1';
  INSERT INTO esiti VALUES ('il negozio non stacca l ordine dal cliente', false, 'la scrittura e passata');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS errore = MESSAGE_TEXT;
  -- 42501: respinta per permesso (il guardiano o la mancanza del diritto), non per altro.
  INSERT INTO esiti VALUES ('il negozio non stacca l ordine dal cliente', SQLSTATE = '42501', SQLSTATE || ' ' || errore);
END $$;
RESET ROLE;

-- ②: l'anonimo nemmeno
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true); END $$;
DO $$
DECLARE errore text;
BEGIN
  UPDATE public.orders SET user_id = NULL WHERE id = 'a1400005-0000-4000-8000-0000000000b1';
  INSERT INTO esiti VALUES ('l anonimo non stacca l ordine dal cliente', false, 'la scrittura e passata');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS errore = MESSAGE_TEXT;
  -- 42501: respinta per permesso (il guardiano o la mancanza del diritto), non per altro.
  INSERT INTO esiti VALUES ('l anonimo non stacca l ordine dal cliente', SQLSTATE = '42501', SQLSTATE || ' ' || errore);
END $$;
RESET ROLE;
DO $$ BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;
DO $$ BEGIN PERFORM set_config('mycity.allow_order_write', '', true); END $$;

INSERT INTO esiti
SELECT 'dopo i due tentativi l ordine di Luca e ancora suo',
       user_id = 'a1400005-0000-4000-8000-000000000003', coalesce(user_id::text, 'NULL')
  FROM public.orders WHERE id = 'a1400005-0000-4000-8000-0000000000b1';

-- =============================================================================
-- La porta resta chiusa ③: la cascata non si porta dietro un cambio di soldi
-- =============================================================================
-- Un grilletto messo prima del guardiano azzera il totale mentre il database
-- stacca l'ordine. Lo stacco e' permesso solo se cambia SOLO `user_id`.
CREATE FUNCTION public.r14_005_manomette() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN NEW.total_price := 0; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aaa_r14_005_manomette BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.r14_005_manomette();

SET LOCAL ROLE supabase_auth_admin;
DO $$
DECLARE errore text;
BEGIN
  DELETE FROM auth.users WHERE id = 'a1400005-0000-4000-8000-000000000003';
  INSERT INTO esiti VALUES ('lo stacco non porta con se il totale', false,
    'la cancellazione e passata col totale azzerato');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS errore = MESSAGE_TEXT;
  -- 42501: respinta per permesso (il guardiano o la mancanza del diritto), non per altro.
  INSERT INTO esiti VALUES ('lo stacco non porta con se il totale', SQLSTATE = '42501', SQLSTATE || ' ' || errore);
END $$;
RESET ROLE;
DROP TRIGGER aaa_r14_005_manomette ON public.orders;
DROP FUNCTION public.r14_005_manomette();

-- =============================================================================
-- La porta resta chiusa ④: anche col profilo gia' sparito
-- =============================================================================
-- Stato che fuori da una cancellazione non esiste (la chiave esterna lo
-- impedisce): il profilo di Luca tolto senza cascata. E' l'unico modo di
-- guardare da sole le condizioni «chi scrive» e «dentro la cascata».
SET LOCAL session_replication_role = replica;
DELETE FROM public.profiles WHERE id = 'a1400005-0000-4000-8000-000000000003';
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM set_config('request.jwt.claims',
  '{"sub":"a1400005-0000-4000-8000-000000000002","role":"authenticated"}', true); END $$;
DO $$
DECLARE errore text;
BEGIN
  UPDATE public.orders SET user_id = NULL WHERE id = 'a1400005-0000-4000-8000-0000000000b1';
  INSERT INTO esiti VALUES ('col profilo sparito il negozio non stacca l ordine', false, 'la scrittura e passata');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS errore = MESSAGE_TEXT;
  -- 42501: respinta per permesso (il guardiano o la mancanza del diritto), non per altro.
  INSERT INTO esiti VALUES ('col profilo sparito il negozio non stacca l ordine', SQLSTATE = '42501', SQLSTATE || ' ' || errore);
END $$;
RESET ROLE;
DO $$ BEGIN PERFORM set_config('request.jwt.claims', '', true); END $$;

-- Il proprietario della tabella, ma con una scrittura diretta (fuori da una cascata).
DO $$
DECLARE errore text;
BEGIN
  UPDATE public.orders SET user_id = NULL WHERE id = 'a1400005-0000-4000-8000-0000000000b1';
  INSERT INTO esiti VALUES ('col profilo sparito una scrittura diretta non stacca l ordine', false,
    'la scrittura e passata');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS errore = MESSAGE_TEXT;
  -- 42501: respinta per permesso (il guardiano o la mancanza del diritto), non per altro.
  INSERT INTO esiti VALUES ('col profilo sparito una scrittura diretta non stacca l ordine', SQLSTATE = '42501', SQLSTATE || ' ' || errore);
END $$;

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  IF (SELECT count(*) FROM esiti) < 12 THEN
    RAISE EXCEPTION 'controlli attesi 12, eseguiti %', (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
