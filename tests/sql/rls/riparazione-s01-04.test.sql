-- =============================================================================
-- S01-04 — Spazi del nome: nomi_pubblici, rider_reviews_ricevute,
--          get_referral_leaderboard()
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① nomi_pubblici dà la prima parola anche con U+00A0, tabulazione, U+3000;
--   ② «Anna Verdi» resta «Anna»;
--   ③ rider_reviews_ricevute dà la prima parola dell'autore;
--   ④ get_referral_leaderboard() dà la prima parola;
--   ⑤ opzioni e permessi delle due viste sono quelli di prima;
--   ⑥ il nome si salva con uno spazio solo fra le parole, anche dal browser.
-- Senza la migrazione 992 ①, ③, ④ e ⑥ sono ROSSI.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e9920000-0000-0000-0000-000000000001', 'negozio-s01-04@test.it', '{"role":"seller"}'),
  ('e9920000-0000-0000-0000-000000000002', 'rider-s01-04@test.it',   '{"role":"rider"}'),
  ('e9920000-0000-0000-0000-000000000003', 'a-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000004', 'b-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000005', 'c-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000006', 'd-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000007', 'x-s01-04@test.it',       '{"role":"buyer"}'),
  ('e9920000-0000-0000-0000-000000000008', 'e-s01-04@test.it',       '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega S01-04',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69, visibile_senza_abbonamento = true
 WHERE id = 'e9920000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', rider_vehicle_type = 'BIKE'
 WHERE id = 'e9920000-0000-0000-0000-000000000002';
UPDATE public.profiles SET full_name = E'Maria Rossi'      WHERE id = 'e9920000-0000-0000-0000-000000000003';
UPDATE public.profiles SET full_name = E'Luca\tBianchi'         WHERE id = 'e9920000-0000-0000-0000-000000000004';
UPDATE public.profiles SET full_name = 'Anna Verdi'             WHERE id = 'e9920000-0000-0000-0000-000000000005';
UPDATE public.profiles SET full_name = E'　Gianni　Neri' WHERE id = 'e9920000-0000-0000-0000-000000000006';

INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
)
SELECT ('a9920000-0000-0000-0000-00000000000' || n)::uuid, ('e9920000-0000-0000-0000-00000000000' || (n + 2))::uuid,
       'e9920000-0000-0000-0000-000000000001', 'e9920000-0000-0000-0000-000000000002', 20, 'PAID', 'DELIVERED',
       'Cliente', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', 450
  FROM generate_series(1, 4) AS n;

INSERT INTO public.store_reviews (store_id, user_id, order_id, rating)
SELECT 'e9920000-0000-0000-0000-000000000001', ('e9920000-0000-0000-0000-00000000000' || (n + 2))::uuid,
       ('a9920000-0000-0000-0000-00000000000' || n)::uuid, 5
  FROM generate_series(1, 4) AS n;
INSERT INTO public.rider_reviews (rider_id, user_id, order_id, rating)
SELECT 'e9920000-0000-0000-0000-000000000002', ('e9920000-0000-0000-0000-00000000000' || (n + 2))::uuid,
       ('a9920000-0000-0000-0000-00000000000' || n)::uuid, 5
  FROM generate_series(1, 2) AS n;
INSERT INTO public.referrals (referrer_id, referred_id, status)
VALUES ('e9920000-0000-0000-0000-000000000003', 'e9920000-0000-0000-0000-000000000008', 'signed_up');

SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL mycity.allow_order_write   = '0';

SET LOCAL ROLE authenticated;

-- Un cliente qualunque.
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-000000000007","role":"authenticated"}';
INSERT INTO esiti SELECT '1 nomi_pubblici dà la prima parola anche con spazi speciali',
  string_agg(nome, ',' ORDER BY id) = 'Maria,Luca,Gianni',
  string_agg(coalesce(nome, '∅'), ' | ' ORDER BY id)
  FROM public.nomi_pubblici
 WHERE id IN ('e9920000-0000-0000-0000-000000000003', 'e9920000-0000-0000-0000-000000000004',
              'e9920000-0000-0000-0000-000000000006');
INSERT INTO esiti SELECT '2 un nome con lo spazio normale resta la prima parola', nome = 'Anna', coalesce(nome, '∅')
  FROM public.nomi_pubblici WHERE id = 'e9920000-0000-0000-0000-000000000005';
INSERT INTO esiti SELECT '4 la classifica degli inviti dà la prima parola', full_name = 'Maria', coalesce(full_name, '∅')
  FROM public.get_referral_leaderboard() WHERE user_id = 'e9920000-0000-0000-0000-000000000003';

-- Il fattorino.
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti SELECT '3 le recensioni del fattorino danno la prima parola dell''autore',
  string_agg(autore_nome, ',' ORDER BY autore_nome) = 'Luca,Maria',
  string_agg(coalesce(autore_nome, '∅'), ' | ' ORDER BY autore_nome)
  FROM public.rider_reviews_ricevute;
-- Il cliente cambia il proprio nome dal browser.
SET LOCAL request.jwt.claims = '{"sub":"e9920000-0000-0000-0000-000000000007","role":"authenticated"}';
UPDATE public.profiles SET full_name = E'Paolo\u00a0\u00a0Gialli ' WHERE id = 'e9920000-0000-0000-0000-000000000007';
RESET ROLE;

INSERT INTO esiti SELECT '6 il nome si salva con uno spazio solo fra le parole',
  string_agg(full_name, ' | ' ORDER BY id) = 'Maria Rossi | Luca Bianchi | Anna Verdi | Gianni Neri | Paolo Gialli',
  string_agg(replace(replace(full_name, E'\u00a0', '<nbsp>'), E'\t', '<tab>'), ' | ' ORDER BY id)
  FROM public.profiles
 WHERE id IN ('e9920000-0000-0000-0000-000000000003', 'e9920000-0000-0000-0000-000000000004',
              'e9920000-0000-0000-0000-000000000005', 'e9920000-0000-0000-0000-000000000006',
              'e9920000-0000-0000-0000-000000000007');

INSERT INTO esiti SELECT '5 opzioni e permessi delle viste sono quelli di prima',
  bool_and(c.reloptions @> ARRAY['security_barrier=true']
           AND (c.reloptions @> ARRAY['security_invoker=false'] OR c.reloptions @> ARRAY['security_invoker=off'])
           AND has_table_privilege('authenticated', c.oid, 'SELECT')
           AND NOT has_table_privilege('anon', c.oid, 'SELECT')),
  string_agg(c.relname || ' ' || array_to_string(c.reloptions, ','), ' | ')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('nomi_pubblici', 'rider_reviews_ricevute');

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 6 THEN
    RAISE EXCEPTION '% controlli su % sono rossi (S01-04)', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'S01-04: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
