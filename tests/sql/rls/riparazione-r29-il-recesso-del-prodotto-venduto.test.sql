-- =============================================================================
-- R29-020 — Il recesso si decide sul prodotto com'era quando e' stato venduto
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
--
-- «Escluso dal recesso» stava solo sul prodotto (products.non_recedibile, 180),
-- e la rotta dei resi lo leggeva com'e' adesso: il negozio poteva spuntarlo dopo
-- la vendita e il cliente si vedeva rifiutare il ripensamento su un prodotto
-- comprato quando era ammesso. Adesso ogni riga d'ordine si porta dietro lo
-- stato del momento della vendita (migrazione 530), scritto dal database e non
-- da chi inserisce, e un cambio sul prodotto dopo non lo tocca.
--
-- La copia si legge con to_jsonb(riga): senza la migrazione la chiave manca e il
-- controllo e' rosso sul comportamento, non per una colonna che non esiste.
-- Dati finti.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2900000-0000-0000-0000-000000000051', 'negozio-r29@test.it', '{"role":"seller"}'),
  ('e2900000-0000-0000-0000-0000000000b1', 'cliente-r29@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET role = 'seller', is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova'
 WHERE id = 'e2900000-0000-0000-0000-000000000051';

-- Il miele si poteva rendere al momento della vendita; la torta no.
INSERT INTO public.products (id, name, price, seller_id, status, images, stock, non_recedibile)
VALUES
  ('e2900000-0000-0000-0000-0000000000a1', 'Miele di prova', 8.00,
   'e2900000-0000-0000-0000-000000000051', 'available', '[]'::jsonb, 10, false),
  ('e2900000-0000-0000-0000-0000000000a2', 'Torta di prova', 20.00,
   'e2900000-0000-0000-0000-000000000051', 'available', '[]'::jsonb, 10, true);

INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_status, delivery_status)
VALUES ('e2900000-0000-0000-0000-0000000000c1', 'e2900000-0000-0000-0000-0000000000b1',
        'e2900000-0000-0000-0000-000000000051', 28.00, 'PAID', 'DELIVERED');

-- Le righe nascono come le scrivono le strade di cassa: la copia la mette il database.
INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price)
VALUES
  ('e2900000-0000-0000-0000-0000000000d1', 'e2900000-0000-0000-0000-0000000000c1',
   'e2900000-0000-0000-0000-0000000000a1', 1, 8.00),
  ('e2900000-0000-0000-0000-0000000000d3', 'e2900000-0000-0000-0000-0000000000c1',
   NULL, 1, 0.50);

-- La riga della torta prova a dire da sola «recedibile»: deve valere il prodotto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'non_recedibile') THEN
    EXECUTE $i$INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price, non_recedibile)
               VALUES ('e2900000-0000-0000-0000-0000000000d2', 'e2900000-0000-0000-0000-0000000000c1',
                       'e2900000-0000-0000-0000-0000000000a2', 1, 20.00, false)$i$;
  ELSE
    INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price)
    VALUES ('e2900000-0000-0000-0000-0000000000d2', 'e2900000-0000-0000-0000-0000000000c1',
            'e2900000-0000-0000-0000-0000000000a2', 1, 20.00);
  END IF;
END $$;

-- Dopo la vendita il negozio cambia idea su tutti e due.
UPDATE public.products SET non_recedibile = true  WHERE id = 'e2900000-0000-0000-0000-0000000000a1';
UPDATE public.products SET non_recedibile = false WHERE id = 'e2900000-0000-0000-0000-0000000000a2';

INSERT INTO esiti
SELECT 'il miele venduto recedibile resta recedibile anche se il negozio lo esclude dopo',
       (to_jsonb(oi) ->> 'non_recedibile') = 'false',
       'copia sulla riga: ' || coalesce(to_jsonb(oi) ->> 'non_recedibile', 'nessuna')
  FROM public.order_items oi WHERE oi.id = 'e2900000-0000-0000-0000-0000000000d1';

INSERT INTO esiti
SELECT 'la torta venduta esclusa resta esclusa, anche se chi inserisce dice il contrario e il negozio la libera dopo',
       (to_jsonb(oi) ->> 'non_recedibile') = 'true',
       'copia sulla riga: ' || coalesce(to_jsonb(oi) ->> 'non_recedibile', 'nessuna')
  FROM public.order_items oi WHERE oi.id = 'e2900000-0000-0000-0000-0000000000d2';

INSERT INTO esiti
SELECT 'una riga senza prodotto vale recedibile',
       (to_jsonb(oi) ->> 'non_recedibile') = 'false',
       'copia sulla riga: ' || coalesce(to_jsonb(oi) ->> 'non_recedibile', 'nessuna')
  FROM public.order_items oi WHERE oi.id = 'e2900000-0000-0000-0000-0000000000d3';

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
