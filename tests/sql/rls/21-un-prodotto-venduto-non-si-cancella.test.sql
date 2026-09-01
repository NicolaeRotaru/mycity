-- =============================================================================
-- Un prodotto che qualcuno ha comprato non si cancella, e la riga d'ordine
-- tiene il suo nome
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
--
-- 27/8/2026 (R029) — CANCELLARE UN PRODOTTO PORTAVA VIA LE RECENSIONI E IL
-- NOME DI QUELLO CHE IL CLIENTE AVEVA COMPRATO.
--
-- Il tasto «Elimina» del pannello venditore cancellava davvero la riga. Da lì
-- due strade, tutte e due brutte:
--
--  · le recensioni erano agganciate al prodotto con ON DELETE CASCADE: chi
--    prendeva una stella la cancellava insieme al prodotto e ripubblicava
--    pulito. Su un marketplace il voto medio E' il prodotto: se si può lavare,
--    non dice più la verità a nessuno.
--  · la riga d'ordine era agganciata con ON DELETE SET NULL e non teneva
--    nessuna copia del nome. Il cliente riapriva un ordine di sei mesi prima e
--    trovava una riga senza nome e senza foto: non sapeva più cosa aveva
--    comprato, e non poteva nemmeno recensirlo.
--
-- Adesso: il database rifiuta la cancellazione di un prodotto che è dentro un
-- ordine o che ha ricevuto una recensione (si nasconde, non si cancella), e
-- ogni riga d'ordine si porta dietro nome e foto del momento in cui è stata
-- creata. Un prodotto mai venduto e mai recensito si cancella ancora: un freno
-- che blocca tutto non è un freno, è un guasto.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
-- I tentativi di cancellazione girano coi permessi veri del negoziante, e da
-- li' dentro il verdetto va comunque scritto: la lavagna e' di tutti.
GRANT ALL ON esiti TO authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0000000-0000-0000-0000-000000000051', 'negozio@test.it', '{"role":"seller"}'),
  ('e0000000-0000-0000-0000-0000000000b1', 'cliente@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET role = 'seller', is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'e0000000-0000-0000-0000-000000000051';

INSERT INTO public.products (id, name, price, seller_id, status, images, stock)
VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'Focaccia di Recco', 6.50,
   'e0000000-0000-0000-0000-000000000051', 'available', '["focaccia.jpg"]'::jsonb, 10),
  ('e0000000-0000-0000-0000-0000000000a2', 'Prodotto mai venduto', 3.00,
   'e0000000-0000-0000-0000-000000000051', 'available', '[]'::jsonb, 5);

INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_status, delivery_status)
VALUES ('e0000000-0000-0000-0000-0000000000c1', 'e0000000-0000-0000-0000-0000000000b1',
        'e0000000-0000-0000-0000-000000000051', 13.00, 'PAID', 'DELIVERED');

-- NB: nome e foto NON si scrivono qui. Li deve mettere il database da solo,
-- altrimenti la copia dipende da quale delle strade di cassa ha creato
-- l'ordine — ed e' esattamente il modo in cui questa roba si rompe.
INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price)
VALUES ('e0000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-0000000000c1',
        'e0000000-0000-0000-0000-0000000000a1', 2, 6.50);

INSERT INTO public.reviews (id, product_id, user_id, rating, comment)
VALUES ('e0000000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-0000000000a1',
        'e0000000-0000-0000-0000-0000000000b1', 1, 'Arrivata fredda');

-- =============================================================================
-- 1. Lo scatto del nome lo fa il database, alla creazione della riga d'ordine
-- =============================================================================
INSERT INTO esiti
SELECT 'la riga d''ordine si porta dietro il nome del prodotto',
       product_name = 'Focaccia di Recco',
       'nome sulla riga: ' || coalesce(product_name, 'VUOTO')
  FROM public.order_items WHERE id = 'e0000000-0000-0000-0000-0000000000d1';

INSERT INTO esiti
SELECT 'la riga d''ordine si porta dietro anche la foto',
       product_image = 'focaccia.jpg',
       'foto sulla riga: ' || coalesce(product_image, 'VUOTA')
  FROM public.order_items WHERE id = 'e0000000-0000-0000-0000-0000000000d1';

-- =============================================================================
-- 2. Il negoziante, coi suoi permessi veri, NON cancella un prodotto venduto
-- =============================================================================
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000051","role":"authenticated"}';

DO $$
DECLARE rifiutata boolean := false; messaggio text := '';
BEGIN
  BEGIN
    DELETE FROM public.products WHERE id = 'e0000000-0000-0000-0000-0000000000a1';
  EXCEPTION WHEN OTHERS THEN
    rifiutata := true;
    messaggio := SQLERRM;
  END;
  INSERT INTO esiti VALUES ('il negoziante non puo'' cancellare un prodotto che ha venduto',
    rifiutata, CASE WHEN rifiutata THEN messaggio ELSE 'la cancellazione e'' andata a buon fine' END);
END $$;

RESET ROLE;

INSERT INTO esiti
SELECT 'il prodotto venduto e'' ancora li''', count(*) = 1, 'prodotti trovati: ' || count(*)
  FROM public.products WHERE id = 'e0000000-0000-0000-0000-0000000000a1';

INSERT INTO esiti
SELECT 'la recensione da una stella e'' ancora li''', count(*) = 1, 'recensioni trovate: ' || count(*)
  FROM public.reviews WHERE id = 'e0000000-0000-0000-0000-0000000000e1';

INSERT INTO esiti
SELECT 'nello storico del cliente la riga sa ancora cosa ha comprato',
       product_id IS NOT NULL AND product_name IS NOT NULL,
       'aggancio: ' || coalesce(product_id::text, 'perso') || ' · nome: ' || coalesce(product_name, 'perso')
  FROM public.order_items WHERE id = 'e0000000-0000-0000-0000-0000000000d1';

-- =============================================================================
-- 3. Nemmeno un prodotto solo recensito (senza ordini) si cancella
-- =============================================================================
INSERT INTO public.reviews (id, product_id, user_id, rating, comment)
VALUES ('e0000000-0000-0000-0000-0000000000e2', 'e0000000-0000-0000-0000-0000000000a2',
        'e0000000-0000-0000-0000-0000000000b1', 1, 'Non mi e'' piaciuto');

SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000051","role":"authenticated"}';

DO $$
DECLARE rifiutata boolean := false;
BEGIN
  BEGIN
    DELETE FROM public.products WHERE id = 'e0000000-0000-0000-0000-0000000000a2';
  EXCEPTION WHEN OTHERS THEN rifiutata := true;
  END;
  INSERT INTO esiti VALUES ('una stella non si cancella cancellando il prodotto',
    rifiutata, CASE WHEN rifiutata THEN 'rifiutata' ELSE 'il voto e'' sparito col prodotto' END);
END $$;

RESET ROLE;

-- =============================================================================
-- 4. Un prodotto mai venduto e mai recensito si cancella ancora
-- =============================================================================
DELETE FROM public.reviews WHERE id = 'e0000000-0000-0000-0000-0000000000e2';

SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000051","role":"authenticated"}';

DO $$
DECLARE andata boolean := true; messaggio text := '';
BEGIN
  BEGIN
    DELETE FROM public.products WHERE id = 'e0000000-0000-0000-0000-0000000000a2';
  EXCEPTION WHEN OTHERS THEN
    andata := false;
    messaggio := SQLERRM;
  END;
  INSERT INTO esiti VALUES ('un prodotto sbagliato, mai venduto, si cancella ancora',
    andata, CASE WHEN andata THEN 'cancellato' ELSE messaggio END);
END $$;

RESET ROLE;

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
