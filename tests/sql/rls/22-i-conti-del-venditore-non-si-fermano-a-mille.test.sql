-- =============================================================================
-- I conti del pannello venditore non si fermano più a mille righe
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
--
-- 27/8/2026 (R070, R071) — DUE NUMERI CHE SBAGLIAVANO PER DIFETTO, IN SILENZIO.
--
-- «Venduti» nella pagina Prodotti scaricava ogni riga d'ordine consegnata del
-- negozio e le sommava nel browser; «Andamento» scaricava tutte le visite ai
-- prodotti degli ultimi 30 giorni, mille righe per volta, fino a ventimila.
-- PostgREST tronca a mille righe quando nessuno chiede un limite, e il tetto
-- duro della lettura a finestre era ventimila: superate quelle soglie i due
-- numeri cominciavano a essere più bassi del vero, senza nessun avviso. Il
-- momento in cui succede è proprio quello in cui i numeri iniziano a contare.
--
-- Qui il negozio ha 1.200 righe consegnate e 25.000 visite: sopra tutte e due
-- le soglie. I conti li fa il database e devono tornare esatti.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f0000000-0000-0000-0000-000000000051', 'negozio@test.it',  '{"role":"seller"}'),
  ('f0000000-0000-0000-0000-000000000052', 'rivale@test.it',   '{"role":"seller"}'),
  ('f0000000-0000-0000-0000-0000000000b1', 'cliente@test.it',  '{"role":"buyer"}');

UPDATE public.profiles
   SET role = 'seller', is_approved = true, approval_status = 'approved'
 WHERE id IN ('f0000000-0000-0000-0000-000000000051', 'f0000000-0000-0000-0000-000000000052');

INSERT INTO public.products (id, name, price, seller_id, status, images, stock) VALUES
  ('f0000000-0000-0000-0000-0000000000a1', 'Pane comune',   2.50, 'f0000000-0000-0000-0000-000000000051', 'available', '[]'::jsonb, 100),
  ('f0000000-0000-0000-0000-0000000000a2', 'Focaccia',      6.50, 'f0000000-0000-0000-0000-000000000051', 'available', '[]'::jsonb, 100),
  ('f0000000-0000-0000-0000-0000000000a9', 'Pane del rivale', 2.00, 'f0000000-0000-0000-0000-000000000052', 'available', '[]'::jsonb, 100);

-- 1.200 ordini consegnati con una riga ciascuno: oltre il tetto delle mille.
INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_status, delivery_status)
SELECT ('f0000001-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       'f0000000-0000-0000-0000-0000000000b1',
       'f0000000-0000-0000-0000-000000000051',
       2.50, 'PAID', 'DELIVERED'
  FROM generate_series(1, 1200) g;

INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
SELECT ('f0000001-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       'f0000000-0000-0000-0000-0000000000a1', 1, 2.50
  FROM generate_series(1, 1200) g;

-- Un ordine NON consegnato: nel conto dei venduti non ci deve entrare.
INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_status, delivery_status)
VALUES ('f0000002-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000b1',
        'f0000000-0000-0000-0000-000000000051', 6.50, 'PAID', 'NEW');
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
VALUES ('f0000002-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a2', 3, 6.50);

-- 25.000 visite negli ultimi 30 giorni: oltre il tetto duro di ventimila.
-- Il trigger anti-gonfiaggio si spegne solo qui dentro: stiamo scrivendo uno
-- storico, non simulando traffico vero. Il ROLLBACK finale rimette tutto.
ALTER TABLE public.product_views DISABLE TRIGGER USER;
INSERT INTO public.product_views (product_id, viewed_at, view_fingerprint)
SELECT 'f0000000-0000-0000-0000-0000000000a1',
       now() - ((g % 29) * interval '1 day') - interval '2 hours',
       'impronta-' || g
  FROM generate_series(1, 25000) g;
-- Qualche visita anche sul secondo prodotto, e una fuori finestra (40 giorni fa)
-- che NON deve entrare nel conto dei trenta giorni.
INSERT INTO public.product_views (product_id, viewed_at, view_fingerprint)
SELECT 'f0000000-0000-0000-0000-0000000000a2', now() - interval '3 days', 'altra-' || g
  FROM generate_series(1, 40) g;
INSERT INTO public.product_views (product_id, viewed_at, view_fingerprint)
SELECT 'f0000000-0000-0000-0000-0000000000a1', now() - interval '40 days', 'vecchia-' || g
  FROM generate_series(1, 500) g;
-- E le visite del rivale, che nei miei numeri non devono comparire.
INSERT INTO public.product_views (product_id, viewed_at, view_fingerprint)
SELECT 'f0000000-0000-0000-0000-0000000000a9', now() - interval '1 day', 'rivale-' || g
  FROM generate_series(1, 70) g;
ALTER TABLE public.product_views ENABLE TRIGGER USER;

INSERT INTO public.reviews (product_id, user_id, rating, comment)
VALUES ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 4, 'Buono');

-- =============================================================================
-- 1. «Venduti»: 1.200, non 1.000
-- =============================================================================
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000051","role":"authenticated"}';

INSERT INTO esiti
SELECT 'i pezzi venduti sono quelli veri, non i primi mille',
       coalesce(venduti, 0) = 1200,
       'venduti: ' || coalesce(venduti::text, 'nessuna riga')
  FROM public.venduti_per_prodotto(ARRAY['f0000000-0000-0000-0000-0000000000a1']::uuid[])
 WHERE product_id = 'f0000000-0000-0000-0000-0000000000a1';

INSERT INTO esiti
SELECT 'un ordine non ancora consegnato non conta fra i venduti',
       count(*) = 0,
       'righe tornate per il prodotto non consegnato: ' || count(*)
  FROM public.venduti_per_prodotto(ARRAY['f0000000-0000-0000-0000-0000000000a2']::uuid[]);

INSERT INTO esiti
SELECT 'i venduti di un altro negozio non si leggono',
       count(*) = 0,
       'righe tornate sul prodotto del rivale: ' || count(*)
  FROM public.venduti_per_prodotto(ARRAY['f0000000-0000-0000-0000-0000000000a9']::uuid[]);

-- =============================================================================
-- 2. «Andamento»: 25.040 visite, non 20.000
-- =============================================================================
INSERT INTO esiti
SELECT 'le visite di trenta giorni sono tutte, non le prime ventimila',
       viste_30 = 25040,
       'viste in 30 giorni: ' || viste_30
  FROM public.andamento_del_negozio();

INSERT INTO esiti
SELECT 'le visite di quaranta giorni fa restano fuori dai trenta giorni',
       viste_30 = 25040 AND viste_30 < 25540,
       'viste in 30 giorni: ' || viste_30 || ' (fuori finestra: 500)'
  FROM public.andamento_del_negozio();

INSERT INTO esiti
SELECT 'le visite del negozio a fianco non finiscono nei miei numeri',
       (viste_per_prodotto ? 'f0000000-0000-0000-0000-0000000000a9') IS FALSE,
       'prodotti contati: ' || (SELECT count(*) FROM jsonb_object_keys(viste_per_prodotto))
  FROM public.andamento_del_negozio();

INSERT INTO esiti
SELECT 'le visite per prodotto tornano con il totale',
       (SELECT sum(value::text::bigint) FROM jsonb_each(viste_per_prodotto)) = viste_30,
       'somma per prodotto: ' || (SELECT sum(value::text::bigint) FROM jsonb_each(viste_per_prodotto))
         || ' · totale: ' || viste_30
  FROM public.andamento_del_negozio();

INSERT INTO esiti
SELECT 'il voto medio e il numero di recensioni arrivano contati',
       voto_medio = 4.00 AND recensioni = 1,
       'voto: ' || coalesce(voto_medio::text, 'nessuno') || ' · recensioni: ' || recensioni
  FROM public.andamento_del_negozio();

RESET ROLE;

-- =============================================================================
-- 3. Il rivale vede i SUOI numeri, non i miei
-- =============================================================================
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000052","role":"authenticated"}';

INSERT INTO esiti
SELECT 'ogni negozio vede solo le visite dei suoi prodotti',
       viste_30 = 70,
       'viste del rivale: ' || viste_30
  FROM public.andamento_del_negozio();

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
