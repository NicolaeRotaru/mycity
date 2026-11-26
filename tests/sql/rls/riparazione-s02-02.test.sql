-- =============================================================================
-- S02-02 — l'id di una recensione
-- =============================================================================
-- Dal browser l'id di una recensione (al negozio o al prodotto) lo sceglie il
-- database: quello mandato non conta. Per chiunque scriva, un id già usato
-- nell'altra tabella delle recensioni è rifiutato (23505). Le recensioni normali
-- entrano come prima, e il server sceglie ancora l'id che vuole se è libero.
-- Migrazione: migrations/998_s02_controlli_piu_stretti.sql.
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- Un negozio (…01) e tre clienti (…02 A, …03 B, …04 C).
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('5e020200-0000-0000-0000-000000000001', 'negozio-s0202@test.it', '{"role":"seller"}'),
  ('5e020200-0000-0000-0000-000000000002', 'cliente-a-s0202@test.it', '{"role":"buyer"}'),
  ('5e020200-0000-0000-0000-000000000003', 'cliente-b-s0202@test.it', '{"role":"buyer"}'),
  ('5e020200-0000-0000-0000-000000000004', 'cliente-c-s0202@test.it', '{"role":"buyer"}');
UPDATE public.profiles
   SET role = 'seller', is_approved = true, approval_status = 'approved', store_name = 'Bottega s0202'
 WHERE id = '5e020200-0000-0000-0000-000000000001';

INSERT INTO public.products (id, name, price, seller_id, status, images, stock) VALUES
  ('5e020200-0000-0000-0000-0000000000a1', 'Pane s0202',  2.50, '5e020200-0000-0000-0000-000000000001', 'available', '[]'::jsonb, 100),
  ('5e020200-0000-0000-0000-0000000000a2', 'Torta s0202', 9.00, '5e020200-0000-0000-0000-000000000001', 'available', '[]'::jsonb, 100);

-- Ordini consegnati: A ne ha tre (c1 c2 c3), B uno (c4), C due (c5 c6).
INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_status, delivery_status) VALUES
  ('5e020200-0000-0000-0000-0000000000c1', '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-000000000001', 2.50, 'PAID', 'DELIVERED'),
  ('5e020200-0000-0000-0000-0000000000c2', '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-000000000001', 2.50, 'PAID', 'DELIVERED'),
  ('5e020200-0000-0000-0000-0000000000c3', '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-000000000001', 2.50, 'PAID', 'DELIVERED'),
  ('5e020200-0000-0000-0000-0000000000c4', '5e020200-0000-0000-0000-000000000003', '5e020200-0000-0000-0000-000000000001', 11.50, 'PAID', 'DELIVERED'),
  ('5e020200-0000-0000-0000-0000000000c5', '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-000000000001', 9.00, 'PAID', 'DELIVERED'),
  ('5e020200-0000-0000-0000-0000000000c6', '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-000000000001', 9.00, 'PAID', 'DELIVERED');
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price) VALUES
  ('5e020200-0000-0000-0000-0000000000c1', '5e020200-0000-0000-0000-0000000000a1', 1, 2.50),
  ('5e020200-0000-0000-0000-0000000000c4', '5e020200-0000-0000-0000-0000000000a1', 1, 2.50),
  ('5e020200-0000-0000-0000-0000000000c4', '5e020200-0000-0000-0000-0000000000a2', 1, 9.00),
  ('5e020200-0000-0000-0000-0000000000c5', '5e020200-0000-0000-0000-0000000000a2', 1, 9.00);

RESET mycity.allow_order_write;
RESET mycity.allow_profile_write;

-- Recensioni già scritte. Per i casi del browser: B al pane (id …e1), C al negozio (id …e2).
-- Per i casi del server, a parte: C alla torta (id …e3), C al negozio (id …e4).
INSERT INTO public.reviews (id, product_id, user_id, rating) VALUES
  ('5e020200-0000-0000-0000-0000000000e1', '5e020200-0000-0000-0000-0000000000a1', '5e020200-0000-0000-0000-000000000003', 5),
  ('5e020200-0000-0000-0000-0000000000e3', '5e020200-0000-0000-0000-0000000000a2', '5e020200-0000-0000-0000-000000000004', 4);
INSERT INTO public.store_reviews (id, store_id, user_id, order_id, rating) VALUES
  ('5e020200-0000-0000-0000-0000000000e2', '5e020200-0000-0000-0000-000000000001', '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-0000000000c5', 4),
  ('5e020200-0000-0000-0000-0000000000e4', '5e020200-0000-0000-0000-000000000001', '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-0000000000c6', 3);

CREATE TEMP TABLE risposte (caso text PRIMARY KEY, stato text) ON COMMIT DROP;
GRANT ALL ON risposte TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.al_negozio(p_caso text, p_id uuid, p_utente uuid, p_ordine uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.store_reviews (store_id, user_id, order_id, rating, comment)
      VALUES ('5e020200-0000-0000-0000-000000000001', p_utente, p_ordine, 5, 'buono');
    ELSE
      INSERT INTO public.store_reviews (id, store_id, user_id, order_id, rating, comment)
      VALUES (p_id, '5e020200-0000-0000-0000-000000000001', p_utente, p_ordine, 5, 'buono');
    END IF;
    INSERT INTO risposte VALUES (p_caso, 'ok');
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.al_negozio(text, uuid, uuid, uuid) TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.al_prodotto(p_caso text, p_id uuid, p_utente uuid, p_prodotto uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.reviews (product_id, user_id, rating, comment)
      VALUES (p_prodotto, p_utente, 5, 'buono');
    ELSE
      INSERT INTO public.reviews (id, product_id, user_id, rating, comment)
      VALUES (p_id, p_prodotto, p_utente, 5, 'buono');
    END IF;
    INSERT INTO risposte VALUES (p_caso, 'ok');
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.al_prodotto(text, uuid, uuid, uuid) TO anon, authenticated, service_role;

-- =============================================================================
-- 1. Cliente A dal browser
-- =============================================================================
SET LOCAL request.jwt.claims = '{"sub":"5e020200-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
-- id scelto dal cliente, libero
SELECT pg_temp.al_negozio('a-negozio-id-scelto', '5e020200-0000-0000-0000-0000000000f1',
                          '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-0000000000c1');
-- id di una recensione al prodotto di un altro
SELECT pg_temp.al_negozio('a-negozio-id-di-reviews', '5e020200-0000-0000-0000-0000000000e1',
                          '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-0000000000c2');
-- senza id
SELECT pg_temp.al_negozio('a-negozio-normale', NULL,
                          '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-0000000000c3');
-- al prodotto con l'id di una recensione al negozio di un altro
SELECT pg_temp.al_prodotto('a-prodotto-id-di-store-reviews', '5e020200-0000-0000-0000-0000000000e2',
                           '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-0000000000a1');
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 2. Cliente B dal browser, senza id
-- =============================================================================
SET LOCAL request.jwt.claims = '{"sub":"5e020200-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.al_prodotto('b-prodotto-normale', NULL,
                           '5e020200-0000-0000-0000-000000000003', '5e020200-0000-0000-0000-0000000000a2');
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 3. Il server
-- =============================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.al_negozio('server-negozio-id-di-reviews', '5e020200-0000-0000-0000-0000000000e3',
                          '5e020200-0000-0000-0000-000000000003', '5e020200-0000-0000-0000-0000000000c4');
SELECT pg_temp.al_negozio('server-negozio-id-libero', '5e020200-0000-0000-0000-0000000000f2',
                          '5e020200-0000-0000-0000-000000000003', '5e020200-0000-0000-0000-0000000000c4');
SELECT pg_temp.al_prodotto('server-prodotto-id-di-store-reviews', '5e020200-0000-0000-0000-0000000000e4',
                           '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-0000000000a1');
DO $$
BEGIN
  BEGIN
    UPDATE public.store_reviews SET id = '5e020200-0000-0000-0000-0000000000e3'
     WHERE id = '5e020200-0000-0000-0000-0000000000f2';
    INSERT INTO risposte VALUES ('server-cambia-id-in-uno-di-reviews', 'ok');
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES ('server-cambia-id-in-uno-di-reviews', SQLSTATE);
  END;
END $$;
RESET ROLE;

-- =============================================================================
-- Controlli
-- =============================================================================
DO $$
DECLARE
  id_a1 uuid := (SELECT id FROM public.store_reviews
                  WHERE order_id = '5e020200-0000-0000-0000-0000000000c1' AND user_id = '5e020200-0000-0000-0000-000000000002');
  id_a2 uuid := (SELECT id FROM public.store_reviews
                  WHERE order_id = '5e020200-0000-0000-0000-0000000000c2' AND user_id = '5e020200-0000-0000-0000-000000000002');
  id_ap uuid := (SELECT id FROM public.reviews
                  WHERE product_id = '5e020200-0000-0000-0000-0000000000a1' AND user_id = '5e020200-0000-0000-0000-000000000002');
  id_b4 uuid := (SELECT id FROM public.store_reviews
                  WHERE order_id = '5e020200-0000-0000-0000-0000000000c4' AND user_id = '5e020200-0000-0000-0000-000000000003');
BEGIN
  -- Dal browser tutto entra: l'id mandato non conta, non e' un motivo per rifiutare.
  INSERT INTO esiti
  SELECT 'dal browser l invio ' || caso || ' entra', stato = 'ok', 'risposta ' || stato
    FROM risposte WHERE caso LIKE 'a-%' OR caso LIKE 'b-%';

  INSERT INTO esiti VALUES ('cliente: l id scelto per la recensione al negozio non conta',
    id_a1 IS NOT NULL AND id_a1 <> '5e020200-0000-0000-0000-0000000000f1'
      AND NOT EXISTS (SELECT 1 FROM public.store_reviews WHERE id = '5e020200-0000-0000-0000-0000000000f1'),
    'id ' || coalesce(id_a1::text, 'nessuna riga'));

  INSERT INTO esiti VALUES ('cliente: la recensione al negozio non prende l id di una recensione al prodotto',
    id_a2 IS NOT NULL AND id_a2 <> '5e020200-0000-0000-0000-0000000000e1'
      AND NOT EXISTS (SELECT 1 FROM public.store_reviews WHERE id = '5e020200-0000-0000-0000-0000000000e1'),
    'id ' || coalesce(id_a2::text, 'nessuna riga'));

  INSERT INTO esiti VALUES ('cliente: la recensione al prodotto non prende l id di una recensione al negozio',
    id_ap IS NOT NULL AND id_ap <> '5e020200-0000-0000-0000-0000000000e2'
      AND NOT EXISTS (SELECT 1 FROM public.reviews WHERE id = '5e020200-0000-0000-0000-0000000000e2'),
    'id ' || coalesce(id_ap::text, 'nessuna riga'));

  INSERT INTO esiti VALUES ('cliente: la recensione al negozio senza id entra',
    EXISTS (SELECT 1 FROM public.store_reviews
             WHERE order_id = '5e020200-0000-0000-0000-0000000000c3' AND user_id = '5e020200-0000-0000-0000-000000000002'),
    '');
  INSERT INTO esiti VALUES ('cliente: la recensione al prodotto senza id entra',
    EXISTS (SELECT 1 FROM public.reviews
             WHERE product_id = '5e020200-0000-0000-0000-0000000000a2' AND user_id = '5e020200-0000-0000-0000-000000000003'),
    '');

  INSERT INTO esiti SELECT 'server: recensione al negozio con l id di una al prodotto rifiutata (23505)',
    stato = '23505', 'risposta ' || stato FROM risposte WHERE caso = 'server-negozio-id-di-reviews';
  INSERT INTO esiti SELECT 'server: recensione al prodotto con l id di una al negozio rifiutata (23505)',
    stato = '23505', 'risposta ' || stato FROM risposte WHERE caso = 'server-prodotto-id-di-store-reviews';
  INSERT INTO esiti SELECT 'server: cambiare l id in uno di una recensione al prodotto e'' rifiutato (23505)',
    stato = '23505', 'risposta ' || stato FROM risposte WHERE caso = 'server-cambia-id-in-uno-di-reviews';
  INSERT INTO esiti SELECT 'server: con un id libero la recensione entra e lo tiene',
    stato = 'ok' AND id_b4 = '5e020200-0000-0000-0000-0000000000f2',
    'risposta ' || stato || ', id ' || coalesce(id_b4::text, 'nessuna riga')
    FROM risposte WHERE caso = 'server-negozio-id-libero';

  INSERT INTO esiti VALUES ('nessun id sta in tutte e due le tabelle',
    NOT EXISTS (SELECT 1 FROM public.store_reviews s JOIN public.reviews r ON r.id = s.id),
    (SELECT count(*) FROM public.store_reviews s JOIN public.reviews r ON r.id = s.id) || ' in comune');
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
