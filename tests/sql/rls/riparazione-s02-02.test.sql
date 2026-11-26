-- =============================================================================
-- S02-02 — l'id di una recensione
-- =============================================================================
-- Dal browser l'id di una recensione (al negozio o al prodotto) lo sceglie il
-- database: quello mandato non conta. L'amministratore e il server scelgono ancora
-- l'id che vogliono, se è libero. Per chiunque scriva, un id già usato nell'altra
-- tabella delle recensioni è rifiutato (23505), anche cambiando l'id dopo. Dal
-- browser anche la data la sceglie il database, e una recensione al negozio nasce
-- senza risposta del negozio e senza voti «utile»; il server li scrive. Le
-- recensioni normali entrano come prima. Fuori da READ COMMITTED una recensione
-- non si scrive (55000).
-- Migrazione: migrations/998_s02_controlli_piu_stretti.sql.
-- Gira dopo tests/sql/harness/apply.sh. Transazioni con ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- Un negozio (…01), tre clienti (…02 A, …03 B, …04 C) e un amministratore (…05).
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('5e020200-0000-0000-0000-000000000001', 'negozio-s0202@test.it', '{"role":"seller"}'),
  ('5e020200-0000-0000-0000-000000000002', 'cliente-a-s0202@test.it', '{"role":"buyer"}'),
  ('5e020200-0000-0000-0000-000000000003', 'cliente-b-s0202@test.it', '{"role":"buyer"}'),
  ('5e020200-0000-0000-0000-000000000004', 'cliente-c-s0202@test.it', '{"role":"buyer"}'),
  ('5e020200-0000-0000-0000-000000000005', 'capo-s0202@test.it', '{"role":"admin"}');
UPDATE public.profiles
   SET role = 'seller', is_approved = true, approval_status = 'approved', store_name = 'Bottega s0202'
 WHERE id = '5e020200-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'admin' WHERE id = '5e020200-0000-0000-0000-000000000005';

INSERT INTO public.products (id, name, price, seller_id, status, images, stock) VALUES
  ('5e020200-0000-0000-0000-0000000000a1', 'Pane s0202',  2.50, '5e020200-0000-0000-0000-000000000001', 'available', '[]'::jsonb, 100),
  ('5e020200-0000-0000-0000-0000000000a2', 'Torta s0202', 9.00, '5e020200-0000-0000-0000-000000000001', 'available', '[]'::jsonb, 100);

-- Ordini consegnati: A c1 c2 c3 ca, B c4 c8 cb, C c5 c6 c9, amministratore c7.
INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_status, delivery_status)
SELECT ('5e020200-0000-0000-0000-0000000000' || o)::uuid, ('5e020200-0000-0000-0000-00000000000' || u)::uuid,
       '5e020200-0000-0000-0000-000000000001', 2.50, 'PAID', 'DELIVERED'
  FROM (VALUES ('c1', '2'), ('c2', '2'), ('c3', '2'), ('ca', '2'), ('c4', '3'), ('c8', '3'), ('cb', '3'),
               ('c5', '4'), ('c6', '4'), ('c9', '4'), ('c7', '5')) AS v(o, u);
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price) VALUES
  ('5e020200-0000-0000-0000-0000000000c1', '5e020200-0000-0000-0000-0000000000a1', 1, 2.50),
  ('5e020200-0000-0000-0000-0000000000c4', '5e020200-0000-0000-0000-0000000000a1', 1, 2.50),
  ('5e020200-0000-0000-0000-0000000000c4', '5e020200-0000-0000-0000-0000000000a2', 1, 9.00),
  ('5e020200-0000-0000-0000-0000000000c5', '5e020200-0000-0000-0000-0000000000a2', 1, 9.00),
  ('5e020200-0000-0000-0000-0000000000c7', '5e020200-0000-0000-0000-0000000000a1', 1, 2.50),
  ('5e020200-0000-0000-0000-0000000000ca', '5e020200-0000-0000-0000-0000000000a2', 1, 9.00);

RESET mycity.allow_order_write;
RESET mycity.allow_profile_write;

-- Recensioni già scritte, ognuna usata da un caso solo:
--   browser: B al pane (…e1), C al negozio su c5 (…e2);
--   server: C alla torta (…e3), C al negozio su c6 (…e4);
--   amministratore: C al negozio su c9 (…e5).
INSERT INTO public.reviews (id, product_id, user_id, rating) VALUES
  ('5e020200-0000-0000-0000-0000000000e1', '5e020200-0000-0000-0000-0000000000a1', '5e020200-0000-0000-0000-000000000003', 5),
  ('5e020200-0000-0000-0000-0000000000e3', '5e020200-0000-0000-0000-0000000000a2', '5e020200-0000-0000-0000-000000000004', 4);
INSERT INTO public.store_reviews (id, store_id, user_id, order_id, rating) VALUES
  ('5e020200-0000-0000-0000-0000000000e2', '5e020200-0000-0000-0000-000000000001', '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-0000000000c5', 4),
  ('5e020200-0000-0000-0000-0000000000e4', '5e020200-0000-0000-0000-000000000001', '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-0000000000c6', 3),
  ('5e020200-0000-0000-0000-0000000000e5', '5e020200-0000-0000-0000-000000000001', '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-0000000000c9', 2);

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

-- Una recensione al negozio con risposta del negozio, voti «utile» e data già scritti.
CREATE FUNCTION pg_temp.al_negozio_compilata(p_caso text, p_utente uuid, p_ordine uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.store_reviews (store_id, user_id, order_id, rating, comment,
                                      seller_reply, seller_reply_at, helpful_count, created_at)
    VALUES ('5e020200-0000-0000-0000-000000000001', p_utente, p_ordine, 1, 'pessimo',
            'Risposta del negozio scritta dal cliente', '2026-01-02 10:00+01', 9999, '2020-01-01 10:00+01');
    INSERT INTO risposte VALUES (p_caso, 'ok');
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.al_negozio_compilata(text, uuid, uuid) TO anon, authenticated, service_role;

-- Una recensione al prodotto con la data già scritta.
CREATE FUNCTION pg_temp.al_prodotto_datata(p_caso text, p_utente uuid, p_prodotto uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.reviews (product_id, user_id, rating, comment, created_at)
    VALUES (p_prodotto, p_utente, 5, 'buono', '2019-01-01 10:00+01');
    INSERT INTO risposte VALUES (p_caso, 'ok');
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.al_prodotto_datata(text, uuid, uuid) TO anon, authenticated, service_role;

-- Cambia l'id di una riga in quello di una riga dell'altra tabella.
CREATE FUNCTION pg_temp.cambia_id(p_caso text, p_tabella text, p_da uuid, p_a uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    IF p_a IS NULL THEN
      INSERT INTO risposte VALUES (p_caso, 'manca l id di destinazione');
      RETURN;
    END IF;
    EXECUTE format('UPDATE public.%I SET id = $1 WHERE id = $2', p_tabella) USING p_a, p_da;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO risposte VALUES (p_caso, CASE WHEN n = 1 THEN 'ok' ELSE 'righe ' || n END);
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.cambia_id(text, text, uuid, uuid) TO anon, authenticated, service_role;

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
-- al negozio con la risposta del negozio, i voti «utile» e la data già scritti
SELECT pg_temp.al_negozio_compilata('a-negozio-finta-risposta',
                                    '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-0000000000ca');
-- al prodotto con la data già scritta
SELECT pg_temp.al_prodotto_datata('a-prodotto-data-scelta',
                                  '5e020200-0000-0000-0000-000000000002', '5e020200-0000-0000-0000-0000000000a2');
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
-- 3. L'amministratore dal browser
-- =============================================================================
SET LOCAL request.jwt.claims = '{"sub":"5e020200-0000-0000-0000-000000000005","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.al_negozio('admin-negozio-id-libero', '5e020200-0000-0000-0000-0000000000f3',
                          '5e020200-0000-0000-0000-000000000005', '5e020200-0000-0000-0000-0000000000c7');
SELECT pg_temp.al_prodotto('admin-prodotto-id-di-store-reviews', '5e020200-0000-0000-0000-0000000000e5',
                           '5e020200-0000-0000-0000-000000000005', '5e020200-0000-0000-0000-0000000000a1');
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 4. Il server
-- =============================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.al_negozio('server-negozio-id-di-reviews', '5e020200-0000-0000-0000-0000000000e3',
                          '5e020200-0000-0000-0000-000000000003', '5e020200-0000-0000-0000-0000000000c4');
SELECT pg_temp.al_negozio('server-negozio-id-libero', '5e020200-0000-0000-0000-0000000000f2',
                          '5e020200-0000-0000-0000-000000000003', '5e020200-0000-0000-0000-0000000000c8');
SELECT pg_temp.al_prodotto('server-prodotto-id-di-store-reviews', '5e020200-0000-0000-0000-0000000000e4',
                           '5e020200-0000-0000-0000-000000000004', '5e020200-0000-0000-0000-0000000000a1');
SELECT pg_temp.al_negozio_compilata('server-negozio-compilata',
                                    '5e020200-0000-0000-0000-000000000003', '5e020200-0000-0000-0000-0000000000cb');
-- store_reviews …f2 prende l'id della recensione di B alla torta (nata nel caso 2)
SELECT pg_temp.cambia_id('server-cambia-id-in-store-reviews', 'store_reviews', '5e020200-0000-0000-0000-0000000000f2',
  (SELECT id FROM public.reviews WHERE product_id = '5e020200-0000-0000-0000-0000000000a2'
                                   AND user_id = '5e020200-0000-0000-0000-000000000003'));
-- reviews …e3 prende l'id della recensione di A al negozio su c3 (nata nel caso 1)
SELECT pg_temp.cambia_id('server-cambia-id-in-reviews', 'reviews', '5e020200-0000-0000-0000-0000000000e3',
  (SELECT id FROM public.store_reviews WHERE order_id = '5e020200-0000-0000-0000-0000000000c3'
                                         AND user_id = '5e020200-0000-0000-0000-000000000002'));
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
  id_b8 uuid := (SELECT id FROM public.store_reviews
                  WHERE order_id = '5e020200-0000-0000-0000-0000000000c8' AND user_id = '5e020200-0000-0000-0000-000000000003');
  id_c7 uuid := (SELECT id FROM public.store_reviews
                  WHERE order_id = '5e020200-0000-0000-0000-0000000000c7' AND user_id = '5e020200-0000-0000-0000-000000000005');
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

  INSERT INTO esiti SELECT 'amministratore: con un id libero la recensione entra e lo tiene',
    stato = 'ok' AND id_c7 = '5e020200-0000-0000-0000-0000000000f3',
    'risposta ' || stato || ', id ' || coalesce(id_c7::text, 'nessuna riga')
    FROM risposte WHERE caso = 'admin-negozio-id-libero';
  INSERT INTO esiti SELECT 'amministratore: recensione al prodotto con l id di una al negozio rifiutata (23505)',
    stato = '23505', 'risposta ' || stato FROM risposte WHERE caso = 'admin-prodotto-id-di-store-reviews';

  INSERT INTO esiti SELECT 'server: recensione al negozio con l id di una al prodotto rifiutata (23505)',
    stato = '23505', 'risposta ' || stato FROM risposte WHERE caso = 'server-negozio-id-di-reviews';
  INSERT INTO esiti SELECT 'server: recensione al prodotto con l id di una al negozio rifiutata (23505)',
    stato = '23505', 'risposta ' || stato FROM risposte WHERE caso = 'server-prodotto-id-di-store-reviews';
  INSERT INTO esiti SELECT 'server: con un id libero la recensione entra e lo tiene',
    stato = 'ok' AND id_b8 = '5e020200-0000-0000-0000-0000000000f2',
    'risposta ' || stato || ', id ' || coalesce(id_b8::text, 'nessuna riga')
    FROM risposte WHERE caso = 'server-negozio-id-libero';
  INSERT INTO esiti SELECT 'server: cambiare l id di una recensione al negozio in uno di reviews e'' rifiutato (23505)',
    stato = '23505', 'risposta ' || stato FROM risposte WHERE caso = 'server-cambia-id-in-store-reviews';
  INSERT INTO esiti SELECT 'server: cambiare l id di una recensione al prodotto in uno di store_reviews e'' rifiutato (23505)',
    stato = '23505', 'risposta ' || stato FROM risposte WHERE caso = 'server-cambia-id-in-reviews';

  INSERT INTO esiti VALUES ('cliente: la recensione al negozio nasce senza risposta del negozio, senza voti «utile» e con la data di adesso',
    EXISTS (SELECT 1 FROM public.store_reviews
             WHERE order_id = '5e020200-0000-0000-0000-0000000000ca' AND user_id = '5e020200-0000-0000-0000-000000000002'
               AND seller_reply IS NULL AND seller_reply_at IS NULL AND helpful_count = 0 AND created_at = now()),
    coalesce((SELECT format('risposta=%s risposta_at=%s utile=%s created_at=%s',
                            coalesce(seller_reply, '∅'), coalesce(seller_reply_at::text, '∅'), helpful_count,
                            CASE WHEN created_at = now() THEN 'adesso' ELSE created_at::text END)
                FROM public.store_reviews
               WHERE order_id = '5e020200-0000-0000-0000-0000000000ca' AND user_id = '5e020200-0000-0000-0000-000000000002'),
             'riga assente'));
  INSERT INTO esiti VALUES ('cliente: la recensione al prodotto nasce con la data di adesso',
    EXISTS (SELECT 1 FROM public.reviews
             WHERE product_id = '5e020200-0000-0000-0000-0000000000a2' AND user_id = '5e020200-0000-0000-0000-000000000002'
               AND created_at = now()),
    coalesce((SELECT CASE WHEN created_at = now() THEN 'adesso' ELSE created_at::text END
                FROM public.reviews
               WHERE product_id = '5e020200-0000-0000-0000-0000000000a2' AND user_id = '5e020200-0000-0000-0000-000000000002'),
             'riga assente'));
  INSERT INTO esiti SELECT 'server: la recensione al negozio tiene risposta, voti «utile» e data che manda',
    stato = 'ok' AND EXISTS (SELECT 1 FROM public.store_reviews
             WHERE order_id = '5e020200-0000-0000-0000-0000000000cb' AND user_id = '5e020200-0000-0000-0000-000000000003'
               AND seller_reply = 'Risposta del negozio scritta dal cliente'
               AND seller_reply_at = '2026-01-02 10:00+01' AND helpful_count = 9999
               AND created_at = '2020-01-01 10:00+01'),
    'risposta ' || stato FROM risposte WHERE caso = 'server-negozio-compilata';

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

-- =============================================================================
-- Fuori da READ COMMITTED una recensione non si scrive (55000)
-- =============================================================================
BEGIN ISOLATION LEVEL REPEATABLE READ;

SET LOCAL mycity.allow_profile_write = '1';
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('5e020200-0000-0000-0000-000000000011', 'negozio-rr-s0202@test.it', '{"role":"seller"}'),
  ('5e020200-0000-0000-0000-000000000012', 'cliente-rr-s0202@test.it', '{"role":"buyer"}');
UPDATE public.profiles SET role = 'seller', is_approved = true, approval_status = 'approved'
 WHERE id = '5e020200-0000-0000-0000-000000000011';
INSERT INTO public.products (id, name, price, seller_id, status, images, stock)
VALUES ('5e020200-0000-0000-0000-0000000000b1', 'Pane rr s0202', 2.50,
        '5e020200-0000-0000-0000-000000000011', 'available', '[]'::jsonb, 100);
RESET mycity.allow_profile_write;

SET LOCAL ROLE service_role;
DO $$
DECLARE stato text;
BEGIN
  BEGIN
    INSERT INTO public.reviews (product_id, user_id, rating)
    VALUES ('5e020200-0000-0000-0000-0000000000b1', '5e020200-0000-0000-0000-000000000012', 5);
    stato := 'ok';
  EXCEPTION WHEN others THEN
    stato := SQLSTATE;
  END;
  IF stato = '55000' THEN
    RAISE INFO 'ok    in REPEATABLE READ la recensione non si scrive (55000)';
    RAISE INFO 'tutti verdi: 1 controlli';
  ELSE
    RAISE INFO 'ROTTO  in REPEATABLE READ la recensione non si scrive (55000)  — risposta %', stato;
    RAISE EXCEPTION '1 controlli su 1 sono rossi';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
