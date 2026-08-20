-- =============================================================================
-- La bacheca dei fattorini e i contatori degli sponsorizzati (migrazione 122)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Due difetti, tre comportamenti:
--
--  · #18/#32 — Ogni fattorino approvato poteva scaricare nome, telefono e
--    indirizzo di casa di TUTTI gli ordini liberi della citta'. Per decidere se
--    accettare una consegna quei dati non servono. Qui si prova che non li vede
--    piu', che vede lo stesso quello che gli serve, e che sull'ordine suo li
--    vede eccome (altrimenti non potrebbe consegnare).
--
--  · #36/#219 — I contatori delle campagne sponsorizzate erano gonfiabili da un
--    visitatore anonimo, senza tetto: cento chiamate, cento visualizzazioni. Su
--    quei numeri un negozio decide se rinnovare. Qui si prova che cento
--    chiamate non fanno cento.
--
-- Tutto in una transazione con ROLLBACK finale: non lascia niente dietro.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it',   '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'fattorino@test.it', '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved'
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- Un ordine libero (nessun fattorino) con i dati di casa del cliente.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip,
  rider_fee_cents
) VALUES (
  'a0000000-0000-0000-0000-00000000000a',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  42.00, 'PAID', 'READY',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121',
  450
);

-- Un ordine gia' preso DA QUESTO fattorino: qui i recapiti servono davvero.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city
) VALUES (
  'c0000000-0000-0000-0000-00000000000c',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  20.00, 'PAID', 'ASSIGNED',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza'
);

INSERT INTO public.sponsored_listings (
  id, seller_id, placement, start_date, end_date,
  daily_budget_cents, spent_cents, impressions, clicks, status
) VALUES (
  'd0000000-0000-0000-0000-00000000000d',
  '11111111-1111-1111-1111-111111111111', 'home_top',
  current_date - 1, current_date + 7, 5000, 0, 0, 0, 'active'
);

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- =============================================================================
-- 1. Il fattorino NON legge i recapiti di un ordine che non ha preso
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.orders
   WHERE id = 'a0000000-0000-0000-0000-00000000000a';
  INSERT INTO esiti VALUES (
    'il fattorino non vede i recapiti degli ordini liberi', n = 0,
    'righe intere visibili: ' || n || ' (dentro ci sono nome, telefono e indirizzo di casa)');
END $$;
RESET ROLE;

-- =============================================================================
-- 2. Ma vede la bacheca, con quello che gli serve per decidere
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE n int; zona text; compenso int;
BEGIN
  SELECT count(*) INTO n FROM public.ordini_disponibili_rider;
  SELECT delivery_city, rider_fee_cents INTO zona, compenso
    FROM public.ordini_disponibili_rider
   WHERE id = 'a0000000-0000-0000-0000-00000000000a';
  INSERT INTO esiti VALUES (
    'la bacheca mostra zona e compenso senza i recapiti',
    n = 1 AND zona = 'Piacenza' AND compenso = 450,
    'ordini in bacheca: ' || n || ' · zona: ' || coalesce(zona, 'nessuna') || ' · compenso: ' || coalesce(compenso, -1));
END $$;
RESET ROLE;

-- =============================================================================
-- 3. Nella bacheca non esiste proprio la colonna del telefono
-- =============================================================================
DO $$
DECLARE colonne text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO colonne
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ordini_disponibili_rider'
     AND column_name IN ('delivery_phone', 'delivery_full_name', 'delivery_address', 'user_id');
  INSERT INTO esiti VALUES ('nella bacheca non ci sono dati personali',
    colonne IS NULL, 'dati personali nella vista: ' || coalesce(colonne, 'nessuno'));
END $$;

-- =============================================================================
-- 4. Sull'ordine che ha preso, il fattorino i recapiti li vede (deve!)
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE tel text;
BEGIN
  SELECT delivery_phone INTO tel FROM public.orders
   WHERE id = 'c0000000-0000-0000-0000-00000000000c';
  INSERT INTO esiti VALUES ('sull''ordine suo il fattorino vede il telefono',
    tel = '3331234567', 'telefono letto: ' || coalesce(tel, 'nessuno'));
END $$;
RESET ROLE;

-- =============================================================================
-- 5. Cento chiamate non fanno cento visualizzazioni
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE i int; conteggio int;
BEGIN
  FOR i IN 1..100 LOOP
    PERFORM public.track_sponsored_impression('d0000000-0000-0000-0000-00000000000d');
  END LOOP;
  SELECT impressions INTO conteggio FROM public.sponsored_listings
   WHERE id = 'd0000000-0000-0000-0000-00000000000d';
  INSERT INTO esiti VALUES (
    'i contatori degli sponsorizzati hanno un tetto', conteggio <= 60 AND conteggio > 0,
    'dopo 100 chiamate il contatore segna: ' || conteggio || ' (prima ne segnava 100)');
END $$;
RESET ROLE;

-- =============================================================================
-- 6. Anche i clic hanno il loro tetto, piu' stretto
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE i int; conteggio int;
BEGIN
  FOR i IN 1..50 LOOP
    PERFORM public.track_sponsored_click('d0000000-0000-0000-0000-00000000000d');
  END LOOP;
  SELECT clicks INTO conteggio FROM public.sponsored_listings
   WHERE id = 'd0000000-0000-0000-0000-00000000000d';
  INSERT INTO esiti VALUES (
    'i clic degli sponsorizzati hanno un tetto piu'' stretto', conteggio <= 10 AND conteggio > 0,
    'dopo 50 clic il contatore segna: ' || conteggio);
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
  SELECT count(*) INTO rossi FROM esiti WHERE NOT ok;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
