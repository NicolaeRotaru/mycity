-- =============================================================================
-- Il catalogo si vede anche senza account (il difetto che azzerava il fatturato)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- La radiografia del 27/8/2026 ha misurato che un visitatore senza account
-- leggeva ZERO prodotti, zero recensioni, zero risultati di ricerca. Il sito
-- mostrava i negozi in home — e quindi sembrava vivo — ma ogni scheda prodotto
-- rispondeva «Prodotto non trovato». Nessun cliente nuovo poteva comprare.
--
-- LA CAUSA. La regola di lettura pubblica dei prodotti chiedeva «il negozio che
-- lo vende e' approvato?» con una domanda dentro `profiles`. Quella domanda
-- viene eseguita coi permessi di CHI GUARDA, e su `profiles` la lettura
-- pubblica era stata chiusa (migrazioni 110 e 112, per non esporre IBAN e
-- documenti). Per un estraneo la domanda tornava sempre falsa: nessun prodotto
-- passava. Il difetto si propagava a `reviews` (chiede «il prodotto e'
-- visibile?») e a `store_reviews` (chiede «il negozio e' approvato?»).
--
-- COSA CONTROLLA. Non guarda il testo delle regole: mette dentro un negozio
-- approvato con un prodotto, una recensione, una recensione negozio, uno sconto
-- attivo e una visita, poi apre una sessione col ruolo `anon` — quello della
-- chiave pubblica che ha ogni browser — e conta quello che vede. Se torna un
-- solo zero, questo file diventa rosso.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- La materia prima: un negozio vero con un prodotto vero
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it', '{"role":"seller"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69,
       stripe_charges_enabled = true, stripe_payouts_enabled = true
 WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.products (id, name, description, price, seller_id, status, stock)
VALUES ('c0000000-0000-0000-0000-0000000000a1', 'Focaccia al rosmarino',
        'Focaccia lievitata 24 ore, cotta al mattino',
        4.50, '11111111-1111-1111-1111-111111111111', 'available', 10);

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_method, payment_status,
  delivery_status, delivered_at, payout_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000000c1',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  4.50, 'card', 'PAID', 'DELIVERED', now(), 'HELD',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
VALUES ('a0000000-0000-0000-0000-0000000000c1',
        'c0000000-0000-0000-0000-0000000000a1', 1, 4.50);

INSERT INTO public.reviews (product_id, user_id, rating, comment)
VALUES ('c0000000-0000-0000-0000-0000000000a1',
        '33333333-3333-3333-3333-333333333333', 5, 'Buonissima');

INSERT INTO public.store_reviews (store_id, user_id, order_id, rating, comment)
VALUES ('11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333',
        'a0000000-0000-0000-0000-0000000000c1', 5, 'Gentilissimi');

INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, starts_at, ends_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'Saldi di fine estate', 20, 'store',
        now() - interval '1 hour', now() + interval '7 days');

INSERT INTO public.product_views (product_id, viewed_at)
VALUES ('c0000000-0000-0000-0000-0000000000a1', now() - interval '1 hour');

RESET mycity.allow_order_write;
RESET mycity.allow_profile_write;

-- ---------------------------------------------------------------------------
-- Da qui in poi si guarda con gli occhi di un visitatore senza account
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;

-- ① La scheda prodotto. E' la riga che il browser chiede quando si clicca un
--    prodotto: senza questa, la pagina scrive «Prodotto non trovato».
INSERT INTO esiti
SELECT 'un visitatore vede il prodotto in vetrina',
       count(*) = 1, 'prodotti visti da anon: ' || count(*)
  FROM public.products WHERE id = 'c0000000-0000-0000-0000-0000000000a1';

-- ② Le recensioni del prodotto: sono la prova sociale che fa comprare.
INSERT INTO esiti
SELECT 'un visitatore vede le recensioni del prodotto',
       count(*) = 1, 'recensioni viste da anon: ' || count(*)
  FROM public.reviews WHERE product_id = 'c0000000-0000-0000-0000-0000000000a1';

-- ③ Le recensioni del negozio.
INSERT INTO esiti
SELECT 'un visitatore vede le recensioni del negozio',
       count(*) = 1, 'recensioni negozio viste da anon: ' || count(*)
  FROM public.store_reviews WHERE store_id = '11111111-1111-1111-1111-111111111111';

-- ④ La ricerca. Chi arriva da un post cerca il nome del prodotto.
INSERT INTO esiti
SELECT 'la ricerca risponde a un visitatore',
       count(*) >= 1, 'risultati di ricerca per anon: ' || count(*)
  FROM public.search_products_smart('focaccia', 10);

-- ⑤ Il voto medio sotto il prezzo.
INSERT INTO esiti
SELECT 'il voto medio del prodotto arriva al visitatore',
       count(*) = 1, 'righe di voto per anon: ' || count(*)
  FROM public.product_rating_stats(ARRAY['c0000000-0000-0000-0000-0000000000a1'::uuid]);

-- ⑥ Il voto medio del negozio.
INSERT INTO esiti
SELECT 'il voto medio del negozio arriva al visitatore',
       count(*) = 1, 'righe di voto negozio per anon: ' || count(*)
  FROM public.store_review_stats(ARRAY['11111111-1111-1111-1111-111111111111'::uuid]);

-- ⑦ La vetrina degli sconti in home.
INSERT INTO esiti
SELECT 'gli sconti in vetrina si vedono senza account',
       count(*) = 1, 'prodotti in saldo per anon: ' || count(*)
  FROM public.active_promo_products(50, '11111111-1111-1111-1111-111111111111');

-- ⑧ La fascia «i piu' visti». Legge le visite, che un estraneo non puo'
--    leggere riga per riga: deve rispondere il conteggio, non le righe.
INSERT INTO esiti
SELECT 'la fascia dei piu'' visti si riempie anche per un visitatore',
       count(*) >= 1, 'prodotti di tendenza per anon: ' || count(*)
  FROM public.trending_product_ids_24h(8);

-- ⑨ Il contrario: quello che era chiuso resta chiuso. La riparazione non deve
--    riaprire `profiles`, che contiene IBAN, documenti e saldo del portafoglio.
INSERT INTO esiti
SELECT 'la tabella dei profili resta chiusa a un visitatore',
       count(*) = 0, 'righe di profiles lette da anon: ' || count(*)
  FROM public.profiles;

-- ⑩ E le visite restano private una per una: solo il conteggio e' pubblico.
INSERT INTO esiti
SELECT 'le visite ai prodotti restano private riga per riga',
       count(*) = 0, 'righe di product_views lette da anon: ' || count(*)
  FROM public.product_views;

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM esiti WHERE ok IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli falliti: il catalogo non si vede senza account', n;
  END IF;
END $$;

ROLLBACK;
