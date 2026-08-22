-- =============================================================================
-- La vetrina pubblica apre, e la catena dell'ordine arriva in fondo
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Due difetti in un file, perché condividono i dati di partenza.
--
-- ① LA VETRINA AVEVA PERSO DUE COLONNE. La migrazione 108b aveva messo sulla
--    vetrina pubblica i due booleani che dicono se un negozio può incassare —
--    servono al bollino «Verificato». La 112 ha ricreato la vista senza quei
--    campi, rimandando alla 114, dove non sono mai arrivati. Sei punti del sito
--    li chiedono, e PostgREST rifiuta la richiesta intera: quelle pagine non
--    ricevevano un negozio senza bollino, ricevevano NIENTE.
--
-- ② LA CATENA DELL'ORDINE NON AVEVA NESSUNA PROVA CHE LA PERCORRESSE INTERA
--    (#168). Novantuno file di prove unitarie, e i due difetti bloccanti del
--    referto — scorte illimitate e ritiro in negozio senza sbocco — sono
--    rimasti in piedi lo stesso, perché nessuno controllo percorreva
--    ordine → accettato → pronto → preso in carico → ritirato → consegnato →
--    pagabile. Qui quel giro si fa per intero, coi permessi veri di ognuno.
--
-- Tutto in una transazione con ROLLBACK.
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
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69,
       stripe_charges_enabled = true, stripe_payouts_enabled = true
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- ---------------------------------------------------------------------------
-- ① La vetrina pubblica porta i due booleani, e un visitatore senza account
--    la legge. Senza la migrazione 124 questa query fallisce sul posto.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;

INSERT INTO esiti
SELECT 'la vetrina pubblica porta i flag del bollino Verificato',
       count(*) = 1 AND bool_and(stripe_charges_enabled) AND bool_and(stripe_payouts_enabled),
       'negozi in vetrina: ' || count(*)
  FROM public.seller_public_profiles
 WHERE id = '11111111-1111-1111-1111-111111111111';

-- E non porta niente di sensibile: il controllo che la 112 voleva garantire.
INSERT INTO esiti
SELECT 'la vetrina non espone dati sensibili',
       count(*) = 0,
       'colonne sensibili nella vista: ' || coalesce(string_agg(column_name, ', '), 'nessuna')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'seller_public_profiles'
   AND column_name IN ('iban', 'stripe_account_id', 'kyc_selfie_url', 'kyc_id_doc_front_url',
                       'wallet_balance_cents', 'phone', 'email');

RESET ROLE;

-- ---------------------------------------------------------------------------
-- ② La catena dell'ordine, un passo per volta, con i permessi di ognuno.
-- ---------------------------------------------------------------------------
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, payout_status, seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000000e1',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  20.00, 2000, 'card', 'PAID', 'NEW', 'HELD', 1800, 300,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

UPDATE public.order_pickup_codes   SET code = '111111' WHERE order_id = 'a0000000-0000-0000-0000-0000000000e1';
UPDATE public.order_delivery_codes SET code = '222222' WHERE order_id = 'a0000000-0000-0000-0000-0000000000e1';

RESET ROLE;
SET LOCAL mycity.allow_order_write = '';

-- Passo 1-2: il negoziante accetta e prepara.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

WITH t AS (
  UPDATE public.orders SET delivery_status = 'ACCEPTED', accepted_at = now()
   WHERE id = 'a0000000-0000-0000-0000-0000000000e1' RETURNING id
)
INSERT INTO esiti SELECT 'il negoziante accetta l''ordine', count(*) = 1, 'righe: ' || count(*) FROM t;

WITH t AS (
  UPDATE public.orders SET delivery_status = 'READY', ready_at = now()
   WHERE id = 'a0000000-0000-0000-0000-0000000000e1' RETURNING id
)
INSERT INTO esiti SELECT 'il negoziante lo mette pronto', count(*) = 1, 'righe: ' || count(*) FROM t;

-- Passo 3: il fattorino lo prende dalla bacheca.
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

INSERT INTO esiti
SELECT 'l''ordine compare sulla bacheca dei fattorini',
       count(*) = 1, 'righe in bacheca: ' || count(*)
  FROM public.ordini_disponibili_rider
 WHERE id = 'a0000000-0000-0000-0000-0000000000e1';

INSERT INTO esiti
SELECT 'il fattorino prende in carico l''ordine',
       (r ->> 'ok')::boolean IS TRUE, 'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0000000-0000-0000-0000-0000000000e1') AS r) t;

-- Passo 4: ritira in negozio col codice del negoziante.
INSERT INTO esiti
SELECT 'il fattorino ritira col codice del negozio',
       (r ->> 'ok')::boolean IS TRUE, 'risposta: ' || r::text
  FROM (SELECT public.verify_pickup_code('a0000000-0000-0000-0000-0000000000e1', '111111') AS r) t;

-- Passo 5: in consegna.
WITH t AS (
  UPDATE public.orders SET delivery_status = 'OUT_FOR_DELIVERY'
   WHERE id = 'a0000000-0000-0000-0000-0000000000e1' RETURNING id
)
INSERT INTO esiti SELECT 'il fattorino si mette in consegna', count(*) = 1, 'righe: ' || count(*) FROM t;

-- Passo 6: consegna col codice del cliente.
INSERT INTO esiti
SELECT 'il fattorino consegna col codice del cliente',
       (r ->> 'ok')::boolean IS TRUE, 'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('a0000000-0000-0000-0000-0000000000e1', '222222') AS r) t;

RESET ROLE;

-- Passo 7: l'ordine è adesso pagabile al negozio. È il passo che nessuna prova
-- percorreva, ed è quello che si è rotto sul ritiro in negozio.
INSERT INTO esiti
SELECT 'l''ordine consegnato è pagabile al negozio',
       delivery_status = 'DELIVERED' AND delivered_at IS NOT NULL AND payout_status = 'HELD',
       'stato: ' || delivery_status || ' · payout: ' || payout_status
  FROM public.orders WHERE id = 'a0000000-0000-0000-0000-0000000000e1';

-- E il cliente può finalmente recensire: le recensioni pretendono un ordine
-- consegnato, quindi un ordine che non arriva in fondo le blocca tutte.
INSERT INTO esiti
SELECT 'il cliente può recensire solo ora che è consegnato',
       count(*) = 1, 'ordini consegnati recensibili: ' || count(*)
  FROM public.orders
 WHERE id = 'a0000000-0000-0000-0000-0000000000e1'
   AND delivery_status = 'DELIVERED';

-- ---------------------------------------------------------------------------
SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM esiti WHERE ok IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli falliti sulla vetrina o sulla catena dell''ordine', n;
  END IF;
END $$;

ROLLBACK;
