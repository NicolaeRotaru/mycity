-- =============================================================================
-- 999t — Il ritiro in negozio non corre con l'annullo dell'amministrazione
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && psql -d mycity_test -f <questo file>
--
-- ① confirm_pickup_by_seller blocca la riga dell'ordine alla lettura (FOR UPDATE)
-- ② la scrittura DELIVERED vale solo se l'ordine è ancora ACCEPTED o READY
-- ③ un ordine annullato prima della conferma: WRONG_STATUS, e resta annullato
-- ④ un ordine pronto col codice giusto: DELIVERED, come prima
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';
CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9990001-1111-4111-8111-111111111111', 'forno-999t@test.it',   '{"role":"seller"}'),
  ('e9990002-2222-4222-8222-222222222222', 'cliente-999t@test.it', '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Forno 999t'
 WHERE id = 'e9990001-1111-4111-8111-111111111111';

SET LOCAL mycity.allow_order_write = '1';
INSERT INTO public.orders (id, user_id, seller_id, total_price, payment_method, payment_status, delivery_status, pickup_in_store,
                           delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip)
VALUES
  ('e9990000-0000-4000-8000-0000000000a1', 'e9990002-2222-4222-8222-222222222222', 'e9990001-1111-4111-8111-111111111111',
   10.00, 'cod', 'PENDING', 'CANCELED', true, 'Cliente', '3330000000', 'Via Roma 1', 'Piacenza', '29121'),
  ('e9990000-0000-4000-8000-0000000000a2', 'e9990002-2222-4222-8222-222222222222', 'e9990001-1111-4111-8111-111111111111',
   10.00, 'cod', 'PENDING', 'READY', true, 'Cliente', '3330000000', 'Via Roma 1', 'Piacenza', '29121');
INSERT INTO public.order_delivery_codes (order_id, code) VALUES
  ('e9990000-0000-4000-8000-0000000000a1', '1234'),
  ('e9990000-0000-4000-8000-0000000000a2', '5678')
ON CONFLICT (order_id) DO UPDATE SET code = EXCLUDED.code;
SET LOCAL mycity.allow_order_write = '';

INSERT INTO esiti SELECT '① la riga dell''ordine si blocca alla lettura',
  pg_get_functiondef('public.confirm_pickup_by_seller(uuid,text)'::regprocedure) ~* 'where\s+id\s*=\s*p_order_id\s*(--[^\n]*\n\s*)*for\s+update', '';
INSERT INTO esiti SELECT '② la scrittura vale solo da ACCEPTED o READY',
  pg_get_functiondef('public.confirm_pickup_by_seller(uuid,text)'::regprocedure) ~* 'delivery_status\s+in\s*\(\s*''ACCEPTED''\s*,\s*''READY''\s*\)\s*;', '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e9990001-1111-4111-8111-111111111111","role":"authenticated"}';
CREATE TEMP TABLE r (caso text, risposta jsonb) ON COMMIT DROP;
INSERT INTO r SELECT 'annullato', public.confirm_pickup_by_seller('e9990000-0000-4000-8000-0000000000a1', '1234');
INSERT INTO r SELECT 'pronto',    public.confirm_pickup_by_seller('e9990000-0000-4000-8000-0000000000a2', '5678');
RESET ROLE;

INSERT INTO esiti SELECT '③ annullato prima: WRONG_STATUS e resta annullato',
  (r.risposta ->> 'ok')::boolean IS FALSE AND r.risposta ->> 'reason' = 'WRONG_STATUS' AND o.delivery_status = 'CANCELED',
  r.risposta::text || ' / ' || o.delivery_status
  FROM r JOIN public.orders o ON o.id = 'e9990000-0000-4000-8000-0000000000a1' WHERE r.caso = 'annullato';
INSERT INTO esiti SELECT '④ pronto col codice giusto: DELIVERED e contanti in negozio',
  (r.risposta ->> 'ok')::boolean AND o.delivery_status = 'DELIVERED' AND o.payout_status = 'CASH_IN_STORE',
  r.risposta::text || ' / ' || o.delivery_status || ' / ' || coalesce(o.payout_status, '-')
  FROM r JOIN public.orders o ON o.id = 'e9990000-0000-4000-8000-0000000000a2' WHERE r.caso = 'pronto';

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE NOTICE '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controllo/i rosso/i sul ritiro che corre con l''annullo', rossi;
  END IF;
  RAISE NOTICE 'il ritiro non corre con l''annullo: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
