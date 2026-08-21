-- =============================================================================
-- Il ritiro in negozio arriva a «consegnato» (migrazione 124, difetto #154)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: un ordine con ritiro in negozio non aveva nessuna strada per
-- arrivare a DELIVERED. L'unico modo di chiudere un ordine era il bottone del
-- fattorino, e su un ritiro il fattorino non c'e'. L'ordine restava in READY
-- per sempre: il negoziante consegnava a mano e non veniva pagato, il cliente
-- vedeva «in corso» all'infinito e non poteva recensire.
--
-- Qui si prova il giro intero coi permessi veri:
--   ① il ritiro NON compare sulla bacheca dei fattorini
--   ② un codice sbagliato non chiude l'ordine
--   ③ un negozio che non e' il suo non lo chiude
--   ④ il codice giusto lo porta a DELIVERED
--   ⑤ sui contanti il pagamento finisce in CASH_IN_STORE, non in un bonifico
--   ⑥ sulla carta il pagamento va in HELD, pronto per il cron
--
-- Senza la 124 i passi ② → ⑥ falliscono con «function does not exist» e il ①
-- e' rosso perche' il ritiro compare fra gli ordini liberi. Tutto in una
-- transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it',   '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'fattorino@test.it', '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',   '{"role":"buyer"}'),
  ('55555555-5555-5555-5555-555555555555', 'altro-negozio@test.it', '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id IN ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id = '22222222-2222-2222-2222-222222222222';

-- Un ritiro in contanti, pronto in negozio.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000000c0',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  20.00, 2000, 'cod', 'PENDING', 'READY', true, 'AWAITING_REMITTANCE', 1800,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- Un ritiro pagato con carta, dello stesso negozio.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000000c1',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  30.00, 3000, 'card', 'PAID', 'READY', true, 'HELD', 2700,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- Codici noti: il trigger ne genera di casuali, qui li fissiamo per provarli.
UPDATE public.order_delivery_codes SET code = '111111'
 WHERE order_id = 'a0000000-0000-0000-0000-0000000000c0';
UPDATE public.order_delivery_codes SET code = '222222'
 WHERE order_id = 'a0000000-0000-0000-0000-0000000000c1';

-- ---------------------------------------------------------------------------
-- ① La bacheca del fattorino non mostra i ritiri: quella merce la ritira il
--    cliente, e un fattorino che se la porta via e' un ordine perso.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

INSERT INTO esiti
SELECT 'i ritiri in negozio non compaiono fra gli ordini liberi',
       count(*) = 0,
       'ritiri visibili in bacheca: ' || count(*)
  FROM public.ordini_disponibili_rider;

-- ---------------------------------------------------------------------------
-- ② Codice sbagliato: l'ordine non si muove.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

INSERT INTO esiti
SELECT 'un codice sbagliato non chiude il ritiro',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'reason') = 'WRONG_CODE',
       'risposta: ' || r::text
  FROM (SELECT public.confirm_pickup_by_seller('a0000000-0000-0000-0000-0000000000c0', '000000') AS r) t;

-- ---------------------------------------------------------------------------
-- ③ Un altro negozio non chiude un ordine che non e' suo.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

INSERT INTO esiti
SELECT 'un altro negozio non puo'' chiudere il ritiro',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'reason') = 'FORBIDDEN',
       'risposta: ' || r::text
  FROM (SELECT public.confirm_pickup_by_seller('a0000000-0000-0000-0000-0000000000c0', '111111') AS r) t;

-- ---------------------------------------------------------------------------
-- ④ e ⑤ Il codice giusto chiude il ritiro in contanti: DELIVERED, e i soldi
--        restano in cassa al negozio invece di partire in bonifico.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

INSERT INTO esiti
SELECT 'il codice giusto chiude il ritiro',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.confirm_pickup_by_seller('a0000000-0000-0000-0000-0000000000c0', '111111') AS r) t;

RESET ROLE;

INSERT INTO esiti
SELECT 'il ritiro in contanti risulta consegnato e incassato in cassa',
       delivery_status = 'DELIVERED'
         AND delivered_at IS NOT NULL
         AND payment_status = 'PAID'
         AND payout_status = 'CASH_IN_STORE',
       'stato: ' || delivery_status || ' · pagamento: ' || payment_status || ' · payout: ' || payout_status
  FROM public.orders WHERE id = 'a0000000-0000-0000-0000-0000000000c0';

-- ---------------------------------------------------------------------------
-- ⑥ Sulla carta i soldi ci sono gia': l'ordine resta in HELD e il cron lo paga.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

INSERT INTO esiti
SELECT 'il codice giusto chiude anche il ritiro con carta',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.confirm_pickup_by_seller('a0000000-0000-0000-0000-0000000000c1', '222222') AS r) t;

RESET ROLE;

INSERT INTO esiti
SELECT 'il ritiro con carta resta pagabile al negozio',
       delivery_status = 'DELIVERED' AND payout_status = 'HELD',
       'stato: ' || delivery_status || ' · payout: ' || payout_status
  FROM public.orders WHERE id = 'a0000000-0000-0000-0000-0000000000c1';

-- ---------------------------------------------------------------------------
SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM esiti WHERE NOT ok;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli falliti sul ritiro in negozio', n;
  END IF;
END $$;

ROLLBACK;
