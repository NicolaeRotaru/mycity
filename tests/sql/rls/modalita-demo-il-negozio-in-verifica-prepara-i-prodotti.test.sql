-- =============================================================================
-- Modalità demo — il negozio in verifica prepara già i suoi prodotti (migrazione 709, punto 8)
-- =============================================================================
-- Nicola, 24/11/2026: «Sì, li prepara subito». Un negozio iscritto e non ancora approvato, con la
-- richiesta mandata («in attesa»), crea e modifica i suoi prodotti. Restano invisibili a tutti gli
-- altri anche se li mette «available». Non scrive prodotti a nome di altri. Chi non ha mandato la
-- richiesta, i rifiutati e i sospesi non creano prodotti. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f7090001-0000-0000-0000-000000000001', 'in-attesa-709@test.it', '{"role":"seller"}'),
  ('f7090002-0000-0000-0000-000000000002', 'senza-richiesta-709@test.it', '{"role":"seller"}'),
  ('f7090003-0000-0000-0000-000000000003', 'rifiutato-709@test.it', '{"role":"seller"}'),
  ('f7090004-0000-0000-0000-000000000004', 'sospeso-709@test.it', '{"role":"seller"}'),
  ('f7090005-0000-0000-0000-000000000005', 'altro-709@test.it', '{"role":"seller"}');

UPDATE public.profiles SET is_approved = false, approval_status = 'pending', approval_requested_at = now(), store_name = 'In attesa 709'
 WHERE id = 'f7090001-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = false, approval_status = 'pending', approval_requested_at = NULL, store_name = 'Senza richiesta 709'
 WHERE id = 'f7090002-0000-0000-0000-000000000002';
UPDATE public.profiles SET is_approved = false, approval_status = 'rejected', approval_requested_at = now(), store_name = 'Rifiutato 709'
 WHERE id = 'f7090003-0000-0000-0000-000000000003';
UPDATE public.profiles SET is_approved = false, approval_status = 'suspended', approval_requested_at = now(), store_name = 'Sospeso 709'
 WHERE id = 'f7090004-0000-0000-0000-000000000004';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Altro 709'
 WHERE id = 'f7090005-0000-0000-0000-000000000005';

RESET mycity.allow_profile_write;

-- Prova a creare un prodotto «available» come il negozio indicato, per il venditore indicato.
CREATE OR REPLACE FUNCTION pg_temp.crea(chi uuid, per uuid, id_prodotto uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
  VALUES (id_prodotto, per, 'Torta 709', 'prova', 9.00, 5, 'available');
  RETURN 'creato';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN RETURN 'negato';
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.crea(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.come(chi uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', chi, 'role', 'authenticated')::text, true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.come(uuid) TO authenticated;

SET LOCAL ROLE authenticated;

SELECT pg_temp.come('f7090001-0000-0000-0000-000000000001');
INSERT INTO esiti SELECT 'in attesa con la richiesta: crea il suo prodotto', r = 'creato', r
  FROM pg_temp.crea('f7090001-0000-0000-0000-000000000001', 'f7090001-0000-0000-0000-000000000001', 'f709aaaa-0000-0000-0000-000000000001') r;
INSERT INTO esiti SELECT 'in attesa: non crea prodotti a nome di un altro negozio', r = 'negato', r
  FROM pg_temp.crea('f7090001-0000-0000-0000-000000000001', 'f7090005-0000-0000-0000-000000000005', 'f709aaaa-0000-0000-0000-000000000002') r;
DO $$
DECLARE n int; esito text;
BEGIN
  SELECT count(*) INTO n FROM public.products WHERE id = 'f709aaaa-0000-0000-0000-000000000001';
  INSERT INTO esiti VALUES ('in attesa: vede il suo prodotto', n = 1, n || ' righe');
  BEGIN
    PERFORM public.salva_prodotto_e_varianti('f709aaaa-0000-0000-0000-000000000001'::uuid, '{"name":"Torta 709 rinominata"}'::jsonb);
    esito := 'salvato';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('in attesa: modifica il suo prodotto dalla porta unica', esito = 'salvato', esito);
END $$;

SELECT pg_temp.come('f7090002-0000-0000-0000-000000000002');
INSERT INTO esiti SELECT 'senza richiesta mandata: non crea prodotti', r = 'negato', r
  FROM pg_temp.crea('f7090002-0000-0000-0000-000000000002', 'f7090002-0000-0000-0000-000000000002', 'f709aaaa-0000-0000-0000-000000000003') r;

SELECT pg_temp.come('f7090003-0000-0000-0000-000000000003');
INSERT INTO esiti SELECT 'rifiutato: non crea prodotti', r = 'negato', r
  FROM pg_temp.crea('f7090003-0000-0000-0000-000000000003', 'f7090003-0000-0000-0000-000000000003', 'f709aaaa-0000-0000-0000-000000000004') r;

SELECT pg_temp.come('f7090004-0000-0000-0000-000000000004');
INSERT INTO esiti SELECT 'sospeso: non crea prodotti', r = 'negato', r
  FROM pg_temp.crea('f7090004-0000-0000-0000-000000000004', 'f7090004-0000-0000-0000-000000000004', 'f709aaaa-0000-0000-0000-000000000005') r;

-- Un altro negozio e un cliente non vedono il prodotto del negozio in verifica, anche se «available».
SELECT pg_temp.come('f7090005-0000-0000-0000-000000000005');
INSERT INTO esiti SELECT 'un altro negozio non vede il prodotto in preparazione', count(*) = 0, count(*) || ' righe'
  FROM public.products WHERE id = 'f709aaaa-0000-0000-0000-000000000001';
RESET ROLE;

SET LOCAL ROLE anon;
INSERT INTO esiti SELECT 'un visitatore non vede il prodotto in preparazione', count(*) = 0, count(*) || ' righe'
  FROM public.products WHERE id = 'f709aaaa-0000-0000-0000-000000000001';
RESET ROLE;

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
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
