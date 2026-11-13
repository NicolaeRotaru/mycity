-- =============================================================================
-- R18-025 — Il fattorino sospeso non tocca più le consegne che aveva in mano (migrazione 420)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Due fattorini, ognuno con un ordine assegnato (da ritirare) e uno ritirato (da consegnare).
-- Uno viene sospeso dall'amministratore, l'altro resta approvato.
-- ① il sospeso non legge più i suoi ordini, recapiti compresi
-- ② il sospeso non ritira col codice del negozio: l'ordine resta ASSIGNED
-- ③ il sospeso non chiude la consegna col codice del cliente: l'ordine resta PICKED_UP
-- ④ quello approvato legge, ritira e consegna come prima
-- Senza la 420 i passi ①, ② e ③ sono rossi. Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2500000-0000-0000-0000-000000000001', 'negozio-r18s@test.it',  '{"role":"seller"}'),
  ('e2500000-0000-0000-0000-000000000002', 'sospeso-r18s@test.it',  '{"role":"rider"}'),
  ('e2500000-0000-0000-0000-000000000003', 'cliente-r18s@test.it',  '{"role":"buyer"}'),
  ('e2500000-0000-0000-0000-000000000004', 'approvato-r18s@test.it', '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = 'e2500000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e2500000-0000-0000-0000-000000000002', 'e2500000-0000-0000-0000-000000000004');

INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, payment_method, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
) VALUES
  ('e2500000-0000-0000-0000-0000000000a1', 'e2500000-0000-0000-0000-000000000003',
   'e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000002',
   20.00, 'card', 'PAID', 'ASSIGNED', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 400),
  ('e2500000-0000-0000-0000-0000000000a2', 'e2500000-0000-0000-0000-000000000003',
   'e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000002',
   21.00, 'card', 'PAID', 'PICKED_UP', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 400),
  ('e2500000-0000-0000-0000-0000000000b1', 'e2500000-0000-0000-0000-000000000003',
   'e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000004',
   22.00, 'card', 'PAID', 'ASSIGNED', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 400),
  ('e2500000-0000-0000-0000-0000000000b2', 'e2500000-0000-0000-0000-000000000003',
   'e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000004',
   23.00, 'card', 'PAID', 'PICKED_UP', 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 400);

-- I codici li crea un trigger, casuali: qui si fissano per poterli digitare.
UPDATE public.order_pickup_codes   SET code = '111111' WHERE order_id IN ('e2500000-0000-0000-0000-0000000000a1', 'e2500000-0000-0000-0000-0000000000b1');
UPDATE public.order_delivery_codes SET code = '222222' WHERE order_id IN ('e2500000-0000-0000-0000-0000000000a2', 'e2500000-0000-0000-0000-0000000000b2');

-- La sospensione come la scrive la rotta dell'amministratore (moderate/route.ts).
UPDATE public.profiles SET is_approved = false, approval_status = 'suspended', rejection_reason = NULL
 WHERE id = 'e2500000-0000-0000-0000-000000000002';

-- Da qui in poi scrive la persona, coi suoi permessi: niente porte di servizio.
SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL mycity.allow_order_write   = '0';

-- ── Il fattorino sospeso ────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2500000-0000-0000-0000-000000000002","role":"authenticated"}';

-- ① Non legge più i suoi ordini, né i recapiti del cliente.
INSERT INTO esiti
SELECT 'sospeso: non legge gli ordini che aveva', count(*) = 0,
       coalesce(string_agg(delivery_status || ' ' || delivery_phone || ' ' || delivery_address, ' | '), 'nessuna riga')
  FROM public.orders WHERE rider_id = 'e2500000-0000-0000-0000-000000000002';

-- ② Non ritira col codice giusto del negozio.
INSERT INTO esiti
SELECT 'sospeso: non ritira col codice del negozio', (r ->> 'ok') = 'false', r::text
  FROM (SELECT public.verify_pickup_code('e2500000-0000-0000-0000-0000000000a1', '111111') AS r) x;

-- ③ Non chiude la consegna col codice giusto del cliente.
INSERT INTO esiti
SELECT 'sospeso: non chiude la consegna col codice del cliente', (r ->> 'ok') = 'false', r::text
  FROM (SELECT public.verify_delivery_code('e2500000-0000-0000-0000-0000000000a2', '222222') AS r) x;

-- ── Il fattorino approvato: tutto come prima ────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"e2500000-0000-0000-0000-000000000004","role":"authenticated"}';

INSERT INTO esiti
SELECT 'approvato: legge i suoi due ordini coi recapiti', count(*) = 2 AND bool_and(delivery_phone = '3331234567'), count(*)::text
  FROM public.orders WHERE rider_id = 'e2500000-0000-0000-0000-000000000004';
INSERT INTO esiti
SELECT 'approvato: ritira col codice del negozio', (r ->> 'ok') = 'true', r::text
  FROM (SELECT public.verify_pickup_code('e2500000-0000-0000-0000-0000000000b1', '111111') AS r) x;
INSERT INTO esiti
SELECT 'approvato: chiude la consegna col codice del cliente', (r ->> 'ok') = 'true', r::text
  FROM (SELECT public.verify_delivery_code('e2500000-0000-0000-0000-0000000000b2', '222222') AS r) x;

RESET ROLE;

-- Gli stati, letti dal proprietario del database: quelli del sospeso non si sono mossi.
INSERT INTO esiti
SELECT 'sospeso: gli ordini restano dove erano (ASSIGNED, PICKED_UP)',
       string_agg(delivery_status, ',' ORDER BY id) = 'ASSIGNED,PICKED_UP',
       string_agg(delivery_status, ',' ORDER BY id)
  FROM public.orders WHERE id IN ('e2500000-0000-0000-0000-0000000000a1', 'e2500000-0000-0000-0000-0000000000a2');
INSERT INTO esiti
SELECT 'approvato: gli ordini avanzano (PICKED_UP, DELIVERED)',
       string_agg(delivery_status, ',' ORDER BY id) = 'PICKED_UP,DELIVERED',
       string_agg(delivery_status, ',' ORDER BY id)
  FROM public.orders WHERE id IN ('e2500000-0000-0000-0000-0000000000b1', 'e2500000-0000-0000-0000-0000000000b2');

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
