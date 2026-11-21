-- =============================================================================
-- R04-007 (21/11/2026) — Una presa persa dice il perché vero: «già preso» solo
-- se l'ordine l'ha preso un altro fattorino; un ordine annullato, tornato in
-- preparazione, già suo o che non c'è è «non più disponibile».
-- =============================================================================
-- Coi permessi veri del fattorino (authenticated + jwt), come la bacheca.
-- Transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a0470001-1111-4111-8111-111111111111', 'negozio-r04-007@test.it',    '{"role":"seller"}'),
  ('a0470002-2222-4222-8222-222222222222', 'fattorino-r04-007@test.it',  '{"role":"rider"}'),
  ('a0470003-3333-4333-8333-333333333333', 'cliente-r04-007@test.it',    '{"role":"buyer"}'),
  ('a0470004-4444-4444-8444-444444444444', 'fattorino2-r04-007@test.it', '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega R04-007',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = 'a0470001-1111-4111-8111-111111111111';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('a0470002-2222-4222-8222-222222222222', 'a0470004-4444-4444-8444-444444444444');

-- Tre ordini senza fattorino: uno pronto, uno annullato dal negozio, uno tornato in preparazione.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
) VALUES
  ('a0470000-0000-4000-8000-00000000000a', 'a0470003-3333-4333-8333-333333333333', 'a0470001-1111-4111-8111-111111111111',
   20.00, 'PAID', 'READY',    'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 300),
  ('a0470000-0000-4000-8000-00000000000b', 'a0470003-3333-4333-8333-333333333333', 'a0470001-1111-4111-8111-111111111111',
   20.00, 'PAID', 'CANCELED', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 300),
  ('a0470000-0000-4000-8000-00000000000c', 'a0470003-3333-4333-8333-333333333333', 'a0470001-1111-4111-8111-111111111111',
   20.00, 'PAID', 'ACCEPTED', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 300);

SET LOCAL ROLE authenticated;

-- Il primo fattorino prende l'ordine pronto.
SET LOCAL request.jwt.claims = '{"sub":"a0470002-2222-4222-8222-222222222222","role":"authenticated"}';
INSERT INTO esiti
SELECT 'l''ordine pronto si prende come prima', (r ->> 'ok')::boolean IS TRUE, 'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0470000-0000-4000-8000-00000000000a') AS r) t;

-- Lo stesso fattorino lo ritocca (pagina rimontata): è suo, non «di un altro».
INSERT INTO esiti
SELECT 'ritoccare un ordine già proprio non dice «preso da un altro»',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'NON_PIU_DISPONIBILE', 'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0470000-0000-4000-8000-00000000000a') AS r) t;

-- Il secondo fattorino arriva tardi: questo sì, l'ha preso un altro.
SET LOCAL request.jwt.claims = '{"sub":"a0470004-4444-4444-8444-444444444444","role":"authenticated"}';
INSERT INTO esiti
SELECT 'chi arriva secondo legge GIA_PRESO',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'GIA_PRESO', 'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0470000-0000-4000-8000-00000000000a') AS r) t;

INSERT INTO esiti
SELECT 'un ordine annullato dal negozio è «non più disponibile», non «già preso»',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'NON_PIU_DISPONIBILE', 'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0470000-0000-4000-8000-00000000000b') AS r) t;

INSERT INTO esiti
SELECT 'un ordine tornato in preparazione è «non più disponibile», non «già preso»',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'NON_PIU_DISPONIBILE', 'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0470000-0000-4000-8000-00000000000c') AS r) t;

INSERT INTO esiti
SELECT 'un ordine che non c''è è «non più disponibile», non «già preso»',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'NON_PIU_DISPONIBILE', 'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0470000-0000-4000-8000-0000000000ff') AS r) t;

-- Chi non è un fattorino approvato resta fermo prima della presa, come prima.
SET LOCAL request.jwt.claims = '{"sub":"a0470003-3333-4333-8333-333333333333","role":"authenticated"}';
INSERT INTO esiti
SELECT 'un cliente qualunque resta NON_FATTORINO',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'NON_FATTORINO', 'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0470000-0000-4000-8000-00000000000b') AS r) t;

RESET ROLE;

-- Nessuna presa non riuscita ha toccato gli ordini.
INSERT INTO esiti
SELECT 'le prese non riuscite non cambiano gli ordini',
       count(*) FILTER (WHERE id = 'a0470000-0000-4000-8000-00000000000a' AND rider_id = 'a0470002-2222-4222-8222-222222222222' AND delivery_status = 'ASSIGNED') = 1
   AND count(*) FILTER (WHERE id = 'a0470000-0000-4000-8000-00000000000b' AND rider_id IS NULL AND delivery_status = 'CANCELED') = 1
   AND count(*) FILTER (WHERE id = 'a0470000-0000-4000-8000-00000000000c' AND rider_id IS NULL AND delivery_status = 'ACCEPTED') = 1,
       'ordini come attesi: ' || count(*)
  FROM public.orders WHERE id::text LIKE 'a0470000-%';

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
