-- =============================================================================
-- R06-013 (12/11/2026) — Un solo ordine senza stato non spegne la Panoramica
-- =============================================================================
-- admin_kpi raggruppava con jsonb_object_agg(delivery_status, n): con un ordine
-- a stato vuoto Postgres risponde «field name must not be null» e cade tutta la
-- funzione. Senza la migrazione 300 questo file è ROSSO.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('a0600000-0000-0000-0000-000000000001', 'forno-r06@test.it', '{"role":"seller"}', now()),
  ('a0600000-0000-0000-0000-000000000002', 'maria-r06@test.it', '{"role":"buyer"}',  now()),
  ('a0600000-0000-0000-0000-000000000003', 'capo-r06@test.it',  '{"role":"admin"}',  now());
UPDATE public.profiles SET role = 'admin' WHERE id = 'a0600000-0000-0000-0000-000000000003';

INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip)
VALUES
  ('a0600000-0000-0000-0000-000000000101', 'a0600000-0000-0000-0000-000000000002', 'a0600000-0000-0000-0000-000000000001',
   10, 1000, 'cod', 'PENDING', 'NEW', false, 'M', '3', 'Via', 'Piacenza', '29121'),
  ('a0600000-0000-0000-0000-000000000102', 'a0600000-0000-0000-0000-000000000002', 'a0600000-0000-0000-0000-000000000001',
   12, 1200, 'cod', 'PENDING', 'NEW', false, 'M', '3', 'Via', 'Piacenza', '29121');

-- Un ordine importato a mano senza stato.
UPDATE public.orders SET delivery_status = NULL WHERE id = 'a0600000-0000-0000-0000-000000000102';
-- E un profilo senza ruolo (il CHECK della colonna lascia passare il NULL).
UPDATE public.profiles SET role = NULL WHERE id = 'a0600000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0600000-0000-0000-0000-000000000003","role":"authenticated"}';

DO $$
DECLARE k jsonb; msg text;
BEGIN
  BEGIN
    k := public.admin_kpi();
    INSERT INTO esiti VALUES ('admin_kpi risponde con un ordine senza stato', true, 'ordini_totali=' || (k->>'ordini_totali'));
    INSERT INTO esiti VALUES (
      'il profilo senza ruolo si conta in senza_ruolo',
      coalesce((k->'utenti'->>'senza_ruolo')::int, 0) >= 1,
      coalesce(k->>'utenti', 'null'));
    INSERT INTO esiti VALUES (
      'l''ordine senza stato si conta in SENZA_STATO',
      coalesce((k->'ordini_per_stato'->>'SENZA_STATO')::int, 0) >= 1,
      coalesce(k->>'ordini_per_stato', 'null'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO esiti VALUES ('admin_kpi risponde con un ordine senza stato', false, msg);
  END;
END $$;

RESET ROLE;
RESET request.jwt.claims;

-- ── Verdetto ──────────────────────────────────────────────────────────────────
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
