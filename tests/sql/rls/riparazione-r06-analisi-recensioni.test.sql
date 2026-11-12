-- =============================================================================
-- R06-017 (12/11/2026) — L'Analisi del negozio conta le recensioni del negozio
-- =============================================================================
-- Un negozio con tre recensioni in store_reviews (5, 2 e 4 stelle) e nessuna
-- recensione ai prodotti: andamento_del_negozio deve dire 3 recensioni e media
-- 3,67, come la pagina Recensioni. Senza la migrazione 302 questo file è ROSSO
-- (recensioni = 0, voto nullo). Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('a0600000-0000-0000-0000-000000000301', 'forno-r06-voti@test.it', '{"role":"seller"}', now()),
  ('a0600000-0000-0000-0000-000000000302', 'anna-r06@test.it',   '{"role":"buyer"}', now()),
  ('a0600000-0000-0000-0000-000000000303', 'bruno-r06@test.it',  '{"role":"buyer"}', now()),
  ('a0600000-0000-0000-0000-000000000304', 'carla-r06@test.it',  '{"role":"buyer"}', now()),
  ('a0600000-0000-0000-0000-000000000305', 'altro-r06@test.it',  '{"role":"seller"}', now());
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Forno dei voti'
 WHERE id IN ('a0600000-0000-0000-0000-000000000301', 'a0600000-0000-0000-0000-000000000305');

INSERT INTO public.orders (id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, delivered_at)
VALUES
  ('a0600000-0000-0000-0000-000000000311', 'a0600000-0000-0000-0000-000000000302', 'a0600000-0000-0000-0000-000000000301',
   10, 1000, 'cod', 'PAID', 'DELIVERED', false, 'A', '3', 'Via', 'Piacenza', '29121', now() - interval '3 days'),
  ('a0600000-0000-0000-0000-000000000312', 'a0600000-0000-0000-0000-000000000303', 'a0600000-0000-0000-0000-000000000301',
   10, 1000, 'cod', 'PAID', 'DELIVERED', false, 'B', '3', 'Via', 'Piacenza', '29121', now() - interval '3 days'),
  ('a0600000-0000-0000-0000-000000000313', 'a0600000-0000-0000-0000-000000000304', 'a0600000-0000-0000-0000-000000000301',
   10, 1000, 'cod', 'PAID', 'DELIVERED', false, 'C', '3', 'Via', 'Piacenza', '29121', now() - interval '3 days'),
  ('a0600000-0000-0000-0000-000000000314', 'a0600000-0000-0000-0000-000000000302', 'a0600000-0000-0000-0000-000000000305',
   10, 1000, 'cod', 'PAID', 'DELIVERED', false, 'A', '3', 'Via', 'Piacenza', '29121', now() - interval '3 days');

INSERT INTO public.store_reviews (store_id, user_id, order_id, rating) VALUES
  ('a0600000-0000-0000-0000-000000000301', 'a0600000-0000-0000-0000-000000000302', 'a0600000-0000-0000-0000-000000000311', 5),
  ('a0600000-0000-0000-0000-000000000301', 'a0600000-0000-0000-0000-000000000303', 'a0600000-0000-0000-0000-000000000312', 2),
  ('a0600000-0000-0000-0000-000000000301', 'a0600000-0000-0000-0000-000000000304', 'a0600000-0000-0000-0000-000000000313', 4),
  -- La recensione di un altro negozio non deve entrare nel conto.
  ('a0600000-0000-0000-0000-000000000305', 'a0600000-0000-0000-0000-000000000302', 'a0600000-0000-0000-0000-000000000314', 1);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0600000-0000-0000-0000-000000000301","role":"authenticated"}';

INSERT INTO esiti
SELECT 'Analisi conta le tre recensioni del negozio', a.recensioni = 3, 'recensioni=' || coalesce(a.recensioni::text, 'null')
  FROM public.andamento_del_negozio() a;
INSERT INTO esiti
SELECT 'Analisi: voto medio 3,67 come la pagina Recensioni', a.voto_medio = 3.67, 'voto_medio=' || coalesce(a.voto_medio::text, 'null')
  FROM public.andamento_del_negozio() a;

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
