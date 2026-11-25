-- =============================================================================
-- 861 — Nome, codice fiscale, nascita e residenza si cambiano solo dal server
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① un negozio collegato non cambia il proprio codice fiscale dal browser;
--   ② un fattorino collegato non cambia il proprio codice fiscale dal browser;
--   ③ un cliente non si scrive un codice fiscale;
--   ④ le altre sei colonne (nome, cognome, nascita, via, città, CAP) non si
--      cambiano dal browser, né per il negozio né per il fattorino;
--   ⑤ il negozio cambia ancora il telefono, il fattorino ancora la targa;
--   ⑥ rimandare il codice fiscale identico non rompe un salvataggio;
--   ⑦ il server (chiave di servizio) cambia ancora il codice fiscale;
--   ⑧ in banca dati nome e codice fiscale del negozio sono ancora quelli veri.
-- Senza la migrazione 861 ①, ②, ③ e ④ sono ROSSI.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e8610000-0000-0000-0000-000000000001', 'negozio-861@test.it', '{"role":"seller"}'),
  ('e8610000-0000-0000-0000-000000000002', 'cliente-861@test.it', '{"role":"buyer"}'),
  ('e8610000-0000-0000-0000-000000000003', 'rider-861@test.it',   '{"role":"rider"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Negozio 861',
       legal_first_name = 'Anna', legal_last_name = 'Bianchi', legal_fiscal_code = 'BNCNNA80A41G535X',
       legal_birth_date = '1980-01-01', legal_residence_addr = 'Via Roma 1',
       legal_residence_city = 'Piacenza', legal_residence_zip = '29121'
 WHERE id = 'e8610000-0000-0000-0000-000000000001';
UPDATE public.profiles SET legal_first_name = 'Mario', legal_last_name = 'Rossi',
       legal_fiscal_code = 'RSSMRA90A01G535X', legal_birth_date = '1990-01-01'
 WHERE id = 'e8610000-0000-0000-0000-000000000003';
RESET mycity.allow_profile_write;

-- Prova a cambiare UNA colonna: vero se la scrittura passa, falso se la guardia la ferma.
CREATE FUNCTION pg_temp.prova(utente uuid, colonna text, valore text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('UPDATE public.profiles SET %I = %L WHERE id = %L', colonna, valore, utente);
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.prova(uuid, text, text) TO authenticated;

-- Le altre sei colonne, con un valore nuovo e valido: torna quelle che sono PASSATE (dovrebbe essere vuoto).
CREATE FUNCTION pg_temp.passate(utente uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  c record;
  passate text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('legal_first_name', 'Giulia'), ('legal_last_name', 'Verdi'), ('legal_birth_date', '1985-06-15'),
    ('legal_residence_addr', 'Via Emilia 99'), ('legal_residence_city', 'Parma'), ('legal_residence_zip', '43121')
  ) AS v(colonna, valore) LOOP
    IF pg_temp.prova(utente, c.colonna, c.valore) THEN passate := passate || c.colonna; END IF;
  END LOOP;
  RETURN array_to_string(passate, ', ');
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.passate(uuid) TO authenticated;

SET LOCAL ROLE authenticated;

-- Il negozio.
SET LOCAL request.jwt.claims = '{"sub":"e8610000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti VALUES ('1 il negozio non cambia il codice fiscale dal browser',
  NOT pg_temp.prova('e8610000-0000-0000-0000-000000000001', 'legal_fiscal_code', 'VRDGLI85H55G535Z'), '');
INSERT INTO esiti SELECT '4a il negozio non cambia le altre sei colonne del titolare', p = '', 'passate: ' || p
  FROM pg_temp.passate('e8610000-0000-0000-0000-000000000001') AS p;
INSERT INTO esiti VALUES ('5a il negozio cambia ancora il telefono del negozio',
  pg_temp.prova('e8610000-0000-0000-0000-000000000001', 'store_phone', '0523000000'), '');
INSERT INTO esiti VALUES ('6 rimandare il codice fiscale identico non rompe il salvataggio',
  pg_temp.prova('e8610000-0000-0000-0000-000000000001', 'legal_fiscal_code', 'BNCNNA80A41G535X'), '');

-- Il fattorino: era l'unico che li scriveva dal browser, adesso passa da /api/rider/anagrafica.
SET LOCAL request.jwt.claims = '{"sub":"e8610000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO esiti VALUES ('2 il fattorino non cambia il codice fiscale dal browser',
  NOT pg_temp.prova('e8610000-0000-0000-0000-000000000003', 'legal_fiscal_code', 'VRDGLI85H55G535Z'), '');
INSERT INTO esiti SELECT '4b il fattorino non cambia le altre sei colonne', p = '', 'passate: ' || p
  FROM pg_temp.passate('e8610000-0000-0000-0000-000000000003') AS p;
INSERT INTO esiti VALUES ('5b il fattorino cambia ancora la targa del mezzo',
  pg_temp.prova('e8610000-0000-0000-0000-000000000003', 'rider_vehicle_plate', 'AB123CD'), '');

-- Il cliente.
SET LOCAL request.jwt.claims = '{"sub":"e8610000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti VALUES ('3 un cliente non si scrive un codice fiscale',
  NOT pg_temp.prova('e8610000-0000-0000-0000-000000000002', 'legal_fiscal_code', 'VRDGLI85H55G535Z'), '');
RESET ROLE;

INSERT INTO esiti SELECT '8 nome e codice fiscale del negozio in banca dati sono ancora quelli veri',
  legal_fiscal_code = 'BNCNNA80A41G535X' AND legal_first_name = 'Anna', legal_fiscal_code || ' ' || legal_first_name
  FROM public.profiles WHERE id = 'e8610000-0000-0000-0000-000000000001';

-- Il server: la rotta usa la chiave di servizio.
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti VALUES ('7 il server cambia ancora il codice fiscale',
  pg_temp.prova('e8610000-0000-0000-0000-000000000003', 'legal_fiscal_code', 'VRDGLI85H55G535Z'), '');

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi: i dati del titolare si cambiano dal browser', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'i dati del titolare si cambiano solo dal server: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
