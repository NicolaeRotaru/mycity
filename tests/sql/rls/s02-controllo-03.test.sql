-- =============================================================================
-- Visite ai prodotti — dal browser una visita con un account e' solo a proprio nome
-- =============================================================================
-- La risposta a una visita scritta col nome di un altro e' sempre la stessa (42501),
-- che quella persona abbia gia' una visita nell'ultima ora o no. Le visite proprie,
-- quelle anonime e quelle del server restano come prima.
-- Migrazione: migrations/810_s02_controllo_03.sql.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'negozio-s02@test.it', '{"role":"seller"}'),
  ('a3333333-3333-3333-3333-333333333333', 'cliente-uno-s02@test.it', '{"role":"buyer"}'),
  ('a4444444-4444-4444-4444-444444444444', 'cliente-due-s02@test.it', '{"role":"buyer"}'),
  ('a5555555-5555-5555-5555-555555555555', 'cliente-tre-s02@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega s02'
 WHERE id = 'a1111111-1111-1111-1111-111111111111';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('a9999999-9999-9999-9999-999999999999',
        'a1111111-1111-1111-1111-111111111111',
        'Pane s02', 'per i test', 3.50, 100, 'available');

RESET mycity.allow_profile_write;

-- Cliente uno ha appena guardato il prodotto (scritta dal database, fuori dalle regole del browser).
INSERT INTO public.product_views (product_id, user_id)
VALUES ('a9999999-9999-9999-9999-999999999999', 'a3333333-3333-3333-3333-333333333333');

CREATE TEMP TABLE risposte (caso text PRIMARY KEY, stato text) ON COMMIT DROP;
GRANT ALL ON risposte TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.prova_visita(p_caso text, p_utente uuid, p_impronta text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.product_views (product_id, user_id, view_fingerprint)
    VALUES ('a9999999-9999-9999-9999-999999999999', p_utente, p_impronta);
    INSERT INTO risposte VALUES (p_caso, 'ok');
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.prova_visita(text, uuid, text) TO anon, authenticated, service_role;

-- =============================================================================
-- 1. Il visitatore senza account, col nome di chi ha guardato e di chi no
-- =============================================================================
SET LOCAL ROLE anon;
SELECT pg_temp.prova_visita('anon-a-nome-di-chi-ha-guardato', 'a3333333-3333-3333-3333-333333333333');
SELECT pg_temp.prova_visita('anon-a-nome-di-chi-non-ha-guardato', 'a4444444-4444-4444-4444-444444444444');
SELECT pg_temp.prova_visita('anon-con-impronta', NULL, 'impronta-s02');
RESET ROLE;

-- =============================================================================
-- 2. Una persona con l'account, col nome di un altro e col proprio
-- =============================================================================
SET LOCAL request.jwt.claims = '{"sub":"a5555555-5555-5555-5555-555555555555","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.prova_visita('cliente-a-nome-di-chi-ha-guardato', 'a3333333-3333-3333-3333-333333333333');
SELECT pg_temp.prova_visita('cliente-a-nome-di-chi-non-ha-guardato', 'a4444444-4444-4444-4444-444444444444');
SELECT pg_temp.prova_visita('cliente-a-proprio-nome', 'a5555555-5555-5555-5555-555555555555');
SELECT pg_temp.prova_visita('cliente-a-proprio-nome-di-nuovo', 'a5555555-5555-5555-5555-555555555555');
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 3. Il server scrive per chi vuole
-- =============================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.prova_visita('server-a-nome-di-un-cliente', 'a4444444-4444-4444-4444-444444444444');
RESET ROLE;

-- =============================================================================
-- Controlli
-- =============================================================================
DO $$
DECLARE
  r_guardato text := (SELECT stato FROM risposte WHERE caso = 'anon-a-nome-di-chi-ha-guardato');
  r_non_guardato text := (SELECT stato FROM risposte WHERE caso = 'anon-a-nome-di-chi-non-ha-guardato');
  c_guardato text := (SELECT stato FROM risposte WHERE caso = 'cliente-a-nome-di-chi-ha-guardato');
  c_non_guardato text := (SELECT stato FROM risposte WHERE caso = 'cliente-a-nome-di-chi-non-ha-guardato');
  visite_uno int;
  visite_tre int;
  visite_due int;
BEGIN
  INSERT INTO esiti VALUES ('anon: col nome di chi ha guardato la risposta e'' 42501',
    r_guardato = '42501', 'risposta ' || coalesce(r_guardato, 'nessuna'));
  INSERT INTO esiti VALUES ('anon: col nome di chi non ha guardato la risposta e'' 42501',
    r_non_guardato = '42501', 'risposta ' || coalesce(r_non_guardato, 'nessuna'));
  INSERT INTO esiti VALUES ('anon: le due risposte sono uguali',
    r_guardato IS NOT DISTINCT FROM r_non_guardato, r_guardato || ' / ' || r_non_guardato);
  INSERT INTO esiti VALUES ('cliente: col nome di chi ha guardato la risposta e'' 42501',
    c_guardato = '42501', 'risposta ' || coalesce(c_guardato, 'nessuna'));
  INSERT INTO esiti VALUES ('cliente: le due risposte sono uguali',
    c_guardato IS NOT DISTINCT FROM c_non_guardato, c_guardato || ' / ' || c_non_guardato);

  INSERT INTO esiti SELECT 'la visita anonima con impronta passa', stato = 'ok', stato
    FROM risposte WHERE caso = 'anon-con-impronta';
  INSERT INTO esiti SELECT 'la visita a proprio nome passa', stato = 'ok', stato
    FROM risposte WHERE caso = 'cliente-a-proprio-nome';
  INSERT INTO esiti SELECT 'la seconda visita a proprio nome nell''ora non da'' errore', stato = 'ok', stato
    FROM risposte WHERE caso = 'cliente-a-proprio-nome-di-nuovo';
  INSERT INTO esiti SELECT 'il server scrive una visita col nome di un cliente', stato = 'ok', stato
    FROM risposte WHERE caso = 'server-a-nome-di-un-cliente';

  SELECT count(*) INTO visite_uno FROM public.product_views
   WHERE product_id = 'a9999999-9999-9999-9999-999999999999' AND user_id = 'a3333333-3333-3333-3333-333333333333';
  SELECT count(*) INTO visite_tre FROM public.product_views
   WHERE product_id = 'a9999999-9999-9999-9999-999999999999' AND user_id = 'a5555555-5555-5555-5555-555555555555';
  SELECT count(*) INTO visite_due FROM public.product_views
   WHERE product_id = 'a9999999-9999-9999-9999-999999999999' AND user_id = 'a4444444-4444-4444-4444-444444444444';
  INSERT INTO esiti VALUES ('le visite di chi ha guardato restano una', visite_uno = 1, visite_uno || ' righe');
  INSERT INTO esiti VALUES ('la visita propria si conta una volta nell''ora', visite_tre = 1, visite_tre || ' righe');
  INSERT INTO esiti VALUES ('dell''altro cliente c''e'' solo la visita del server', visite_due = 1, visite_due || ' righe');
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
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
