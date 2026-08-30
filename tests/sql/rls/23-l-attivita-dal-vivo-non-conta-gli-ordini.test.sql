-- =============================================================================
-- Il riquadro «attività dal vivo» dice che si compra, non quanto vende ognuno
-- =============================================================================
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
--
-- 27/8/2026 (R030) — LA RIPARAZIONE DI AGOSTO NON AVEVA CHIUSO IL BUCO.
--
-- La vista `live_activity_public` alimenta il riquadro in home che mostra che il marketplace è
-- vivo. È a permessi di definizione (`security_invoker = off`), quindi le regole per riga degli
-- ordini non la fermano: quello che c'è dentro lo legge chiunque, con la chiave pubblica che ha
-- ogni browser.
--
-- La migrazione 120 aveva tolto l'identificativo dell'ordine e arrotondato l'orario all'ora, e nel
-- suo stesso commento diceva: «basta a dire poco fa, non basta a mettere gli ordini in fila».
-- Solo che una riga per ordine c'era ancora — niente DISTINCT, niente raggruppamento — e contare
-- le righe è contare gli ordini. Chi legge la vista a intervalli ricostruisce quanti ordini fa
-- ogni bottega di Piacenza e in quali ore.
--
-- Non escono soldi e non escono dati dei clienti (la colonna è la città, che a Piacenza vale per
-- tutti). Esce la promessa fatta al negoziante — «i tuoi numeri restano tuoi» — e una migrazione
-- che dichiara di averla mantenuta mentre non lo fa è peggio del difetto: fa smettere di
-- controllare.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'fornaio@test.it', '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'fiorista@test.it', '{"role":"seller"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',  '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Fiori di Via Verdi',
       store_address = 'Via Verdi 3', store_lat = 45.06, store_lng = 9.70
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- Tre ordini dello stesso negozio nella stessa ora, più uno di un altro negozio.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, payout_status, seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, created_at
) VALUES
  ('a0000000-0000-0000-0000-0000000000e1', '33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 20.00, 2000, 'card', 'PAID', 'NEW', 'HELD', 1800, 300,
   'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', now() - interval '10 minutes'),
  ('a0000000-0000-0000-0000-0000000000e2', '33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 15.00, 1500, 'card', 'PAID', 'NEW', 'HELD', 1350, 300,
   'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', now() - interval '11 minutes'),
  ('a0000000-0000-0000-0000-0000000000e3', '33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 9.00, 900, 'card', 'PAID', 'NEW', 'HELD', 800, 300,
   'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', now() - interval '12 minutes'),
  ('a0000000-0000-0000-0000-0000000000e4', '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 30.00, 3000, 'card', 'PAID', 'NEW', 'HELD', 2700, 300,
   'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', now() - interval '13 minutes');

-- ---------------------------------------------------------------------------
-- Da qui in poi si guarda con gli occhi di un estraneo: la chiave pubblica.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;

INSERT INTO esiti
SELECT 'tre ordini dello stesso negozio nella stessa ora sono UNA riga',
       count(*) = 1,
       'righe per Pane Quotidiano: ' || count(*) || ' (erano tre, una per ordine)'
  FROM public.live_activity_public
 WHERE store_name = 'Pane Quotidiano';

INSERT INTO esiti
SELECT 'il riquadro continua a dire che si compra: gli altri negozi ci sono',
       count(*) = 1,
       'righe per Fiori di Via Verdi: ' || count(*)
  FROM public.live_activity_public
 WHERE store_name = 'Fiori di Via Verdi';

RESET ROLE;

INSERT INTO esiti
SELECT 'la vista non porta più l identificativo del negozio',
       count(*) = 0,
       'colonne di troppo: ' || coalesce(string_agg(column_name, ', '), 'nessuna')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'live_activity_public'
   AND column_name IN ('id', 'seller_id', 'user_id', 'total_price', 'delivery_address',
                       'delivery_full_name', 'delivery_phone');

-- L'orario resta arrotondato all'ora: serve a dire «poco fa», non a mettere gli ordini in fila.
INSERT INTO esiti
SELECT 'l orario resta arrotondato all ora',
       bool_and(created_at = date_trunc('hour', created_at)),
       'righe guardate: ' || count(*)
  FROM public.live_activity_public;

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
