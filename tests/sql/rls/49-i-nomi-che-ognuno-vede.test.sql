-- =============================================================================
-- I nomi che ognuno vede: la vista nomi_pubblici (164) e la funzione
-- nomi_dei_clienti_del_negozio (181), su un database vero
-- =============================================================================
-- 5/11/2026 (S04, schede 2430 e 2449). Le due regole su chi vede il nome di chi
-- erano provate solo su un database finto (tests/unit): una «OR true» messa nella
-- funzione lasciava le prove verdi. Qui girano le regole vere:
--   nomi_pubblici
--     ① l'anonimo non legge la vista (permesso negato);
--     ② il cliente legge il nome del SUO fattorino;
--     ③ un estraneo non legge il nome di quel fattorino;
--   nomi_dei_clienti_del_negozio
--     ④ il negozio legge i nomi dei suoi clienti (ordine, chat, recensione);
--     ⑤ un altro negozio, con gli stessi id, non legge niente;
--     ⑥ l'anonimo non può chiamarla.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('d4900000-0000-0000-0000-000000000001', 'forno-49@test.it',  '{"role":"seller"}'),
  ('d4900000-0000-0000-0000-000000000002', 'rider-49@test.it',  '{"role":"rider"}'),
  ('d4900000-0000-0000-0000-000000000003', 'maria-49@test.it',  '{"role":"buyer"}'),
  ('d4900000-0000-0000-0000-000000000004', 'giulia-49@test.it', '{"role":"buyer"}'),
  ('d4900000-0000-0000-0000-000000000005', 'altro-49@test.it',  '{"role":"seller"}'),
  ('d4900000-0000-0000-0000-000000000006', 'luca-49@test.it',   '{"role":"buyer"}');

UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'd4900000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Altro negozio'
 WHERE id = 'd4900000-0000-0000-0000-000000000005';
UPDATE public.profiles SET full_name = 'Paolo Bianchi', is_approved = true, approval_status = 'approved'
 WHERE id = 'd4900000-0000-0000-0000-000000000002';
UPDATE public.profiles SET full_name = 'Maria Rossi'  WHERE id = 'd4900000-0000-0000-0000-000000000003';
UPDATE public.profiles SET full_name = 'Giulia Verdi' WHERE id = 'd4900000-0000-0000-0000-000000000004';
UPDATE public.profiles SET full_name = 'Luca Neri'    WHERE id = 'd4900000-0000-0000-0000-000000000006';

-- Maria ha ordinato dal forno e Paolo le porta l'ordine. Giulia ha scritto in
-- chat al forno. Luca ha recensito il forno.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'd4900000-0000-0000-0000-0000000000a1', 'd4900000-0000-0000-0000-000000000003', 'd4900000-0000-0000-0000-000000000001',
  'd4900000-0000-0000-0000-000000000002', 20, 2000, 'card', 'PAID', 'OUT_FOR_DELIVERY', false,
  'Maria Rossi', '333', 'Via Verdi 1', 'Piacenza', '29121');
INSERT INTO public.conversations (id, buyer_id, seller_id)
VALUES ('d4900000-0000-0000-0000-0000000000c1', 'd4900000-0000-0000-0000-000000000004', 'd4900000-0000-0000-0000-000000000001');
-- (la recensione vuole un ordine: basta che esista, Luca non ne è il cliente)
INSERT INTO public.store_reviews (store_id, user_id, order_id, rating, comment)
VALUES ('d4900000-0000-0000-0000-000000000001', 'd4900000-0000-0000-0000-000000000006',
        'd4900000-0000-0000-0000-0000000000a1', 5, 'Ottimo pane');

-- ── ① L'anonimo non legge la vista ────────────────────────────────────────────
SET LOCAL ROLE anon;
DO $$
DECLARE negato boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.nomi_pubblici LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN negato := true;
  END;
  INSERT INTO esiti VALUES ('l anonimo non legge nomi_pubblici (2430)', negato, '');
END $$;
RESET ROLE;

-- ── ② Il cliente legge il nome del suo fattorino ────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4900000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO esiti
SELECT 'il cliente legge il nome del suo fattorino (2430)', count(*) = 1 AND min(nome) = 'Paolo', coalesce(min(nome), '(niente)')
  FROM public.nomi_pubblici WHERE id = 'd4900000-0000-0000-0000-000000000002';
RESET ROLE;
RESET request.jwt.claims;

-- ── ③ Un estraneo non legge il nome di quel fattorino ───────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4900000-0000-0000-0000-000000000004","role":"authenticated"}';
INSERT INTO esiti
SELECT 'un estraneo non legge il nome del fattorino di un altro (2430)', count(*) = 0, count(*) || ' righe'
  FROM public.nomi_pubblici WHERE id = 'd4900000-0000-0000-0000-000000000002';
RESET ROLE;
RESET request.jwt.claims;

-- ── ④ Il negozio legge i nomi dei suoi clienti ─────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4900000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti
SELECT 'il negozio legge i nomi di chi ha ordinato, scritto o recensito (2449)',
       count(*) = 3, coalesce(string_agg(full_name, ', ' ORDER BY full_name), '(niente)')
  FROM public.nomi_dei_clienti_del_negozio(ARRAY[
    'd4900000-0000-0000-0000-000000000003', 'd4900000-0000-0000-0000-000000000004',
    'd4900000-0000-0000-0000-000000000006']::uuid[]);
RESET ROLE;
RESET request.jwt.claims;

-- ── ⑤ Un altro negozio, con gli stessi id, non legge niente ──────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d4900000-0000-0000-0000-000000000005","role":"authenticated"}';
INSERT INTO esiti
SELECT 'un altro negozio non legge i nomi dei clienti del forno (2449)',
       count(*) = 0, coalesce(string_agg(full_name, ', '), 'niente')
  FROM public.nomi_dei_clienti_del_negozio(ARRAY[
    'd4900000-0000-0000-0000-000000000003', 'd4900000-0000-0000-0000-000000000004',
    'd4900000-0000-0000-0000-000000000006']::uuid[]);
RESET ROLE;
RESET request.jwt.claims;

-- ── ⑥ L'anonimo non può chiamarla ──────────────────────────────────────────────
INSERT INTO esiti
SELECT 'l anonimo non chiama nomi_dei_clienti_del_negozio (2449)',
       NOT has_function_privilege('anon', 'public.nomi_dei_clienti_del_negozio(uuid[])', 'EXECUTE'), '';

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
