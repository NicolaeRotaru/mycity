-- =============================================================================
-- R08-016 — La campanella «Ordine pronto» dice la fascia, non «a breve» (321)
-- =============================================================================
--   ① ordine a domicilio con la fascia «Oggi · 11:00–13:00»: niente «a breve»,
--     c'è «nella fascia che hai scelto (11:00–13:00)»;
--   ② consegna veloce («Adesso · …»): resta «a breve», che lì è vero;
--   ③ ordine senza fascia: resta «a breve»;
--   ④ ritiro in negozio: come prima, «passare a ritirarlo in negozio».
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('e3210000-0000-0000-0000-000000000001', 'forno-321@test.it', '{"role":"seller"}', now()),
  ('e3210000-0000-0000-0000-000000000003', 'maria-321@test.it', '{"role":"buyer"}',  now());

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Forno 321', store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'e3210000-0000-0000-0000-000000000001';

INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, delivery_slot, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip)
VALUES
  ('e3210000-0000-0000-0000-0000000000a1', 'e3210000-0000-0000-0000-000000000003', 'e3210000-0000-0000-0000-000000000001',
   10, 1000, 'card', 'PAID', 'ACCEPTED', false, 'Oggi · 11:00–13:00', 'Maria', '3', 'Via Verdi 1', 'Piacenza', '29121'),
  ('e3210000-0000-0000-0000-0000000000a2', 'e3210000-0000-0000-0000-000000000003', 'e3210000-0000-0000-0000-000000000001',
   10, 1000, 'card', 'PAID', 'ACCEPTED', false, 'Adesso · arrivo in 45 minuti', 'Maria', '3', 'Via Verdi 1', 'Piacenza', '29121'),
  ('e3210000-0000-0000-0000-0000000000a3', 'e3210000-0000-0000-0000-000000000003', 'e3210000-0000-0000-0000-000000000001',
   10, 1000, 'card', 'PAID', 'ACCEPTED', false, NULL, 'Maria', '3', 'Via Verdi 1', 'Piacenza', '29121'),
  ('e3210000-0000-0000-0000-0000000000a4', 'e3210000-0000-0000-0000-000000000003', 'e3210000-0000-0000-0000-000000000001',
   10, 1000, 'card', 'PAID', 'ACCEPTED', true, NULL, 'Maria', '3', 'Via Verdi 1', 'Piacenza', '29121');

UPDATE public.orders SET delivery_status = 'READY' WHERE id::text LIKE 'e3210000-%';

CREATE TEMP TABLE pronti ON COMMIT DROP AS
SELECT replace(link, '/orders/', '') AS ordine, body
  FROM public.notifications
 WHERE user_id = 'e3210000-0000-0000-0000-000000000003' AND title = 'Ordine pronto';

INSERT INTO esiti SELECT '① con la fascia 11:00–13:00 la campanella non dice «a breve»',
  coalesce(bool_and(body NOT LIKE '%a breve%'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e3210000-0000-0000-0000-0000000000a1';
INSERT INTO esiti SELECT '① e dice la fascia scelta, con l orario',
  coalesce(bool_and(body LIKE '%nella fascia che hai scelto (11:00–13:00).'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e3210000-0000-0000-0000-0000000000a1';
INSERT INTO esiti SELECT '② la consegna veloce resta «a breve»',
  coalesce(bool_and(body LIKE '%a breve%'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e3210000-0000-0000-0000-0000000000a2';
INSERT INTO esiti SELECT '③ senza fascia resta «a breve»',
  coalesce(bool_and(body LIKE '%a breve%'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e3210000-0000-0000-0000-0000000000a3';
INSERT INTO esiti SELECT '④ il ritiro in negozio resta «passare a ritirarlo in negozio»',
  coalesce(bool_and(body LIKE '%passare a ritirarlo in negozio%'), false), string_agg(body, ' / ')
  FROM pronti WHERE ordine = 'e3210000-0000-0000-0000-0000000000a4';
INSERT INTO esiti SELECT 'una campanella per ordine', count(*) = 4, count(*) || ' avvisi' FROM pronti;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;
