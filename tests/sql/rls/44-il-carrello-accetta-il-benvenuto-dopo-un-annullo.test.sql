-- =============================================================================
-- Il carrello accetta il codice di benvenuto dopo un ordine annullato (185)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: check_coupon (114) contava TUTTI gli ordini del cliente. Maria,
-- col solo primo ordine annullato dal negozio, si vedeva rifiutare BENVENUTO10
-- dal carrello mentre la cassa (lib/coupons.ts) l'avrebbe accettato.
--   ① solo ordine annullato      → il carrello accetta
--   ② annullato + pagamento fallito → accetta
--   ③ in più un ordine consegnato → rifiuta («solo al primo ordine»)
-- Senza la 185 il passo ① e il ② sono rossi. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it', '{"role":"seller"}'),
  ('33333333-3333-3333-3333-333333333333', 'maria@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.coupons (code, type, value, first_order_only, active)
VALUES ('BENVENUTO_PROVA', 'PERCENT', 10, true, true);

-- Il primo ordine di Maria, annullato dal negozio.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000001a0',
  '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
  20.00, 2000, 'cod', 'PENDING', 'CANCELED',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
INSERT INTO esiti
SELECT '1 solo annullato: accetta', (r->>'ok')::boolean, r::text
  FROM (SELECT public.check_coupon('benvenuto_prova', 20) AS r) x;
RESET ROLE;

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000001a1',
  '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
  20.00, 2000, 'card', 'FAILED', 'NEW',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
INSERT INTO esiti
SELECT '2 annullato + fallito: accetta', (r->>'ok')::boolean, r::text
  FROM (SELECT public.check_coupon('benvenuto_prova', 20) AS r) x;
RESET ROLE;

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000001a2',
  '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
  20.00, 2000, 'card', 'PAID', 'DELIVERED',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
INSERT INTO esiti
SELECT '3 con un consegnato: rifiuta', (r->>'ok')::boolean IS FALSE
       AND r->>'reason' = 'Codice valido solo al primo ordine', r::text
  FROM (SELECT public.check_coupon('benvenuto_prova', 20) AS r) x;
RESET ROLE;

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM esiti WHERE ok IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli falliti sul codice di benvenuto nel carrello', n;
  END IF;
END $$;

ROLLBACK;
