-- =============================================================================
-- R08-007 — Il rifiuto ha la sua ora (migrations/320)
-- =============================================================================
-- La potatura dei documenti dei respinti conta i 90 giorni da `rejected_at`, non
-- più da `approved_at`, che torna a essere la data dell'approvazione:
--   ① respinto 100 giorni fa, approvato (una volta) ieri  → si pota;
--   ② approvato anni fa, respinto ieri                   → NON si pota;
--   ③ respinto prima della 320 (solo approved_at, vecchio) → si pota ancora (ripiego);
--   ④ una persona non può scriversi `rejected_at` da sola.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e3200000-0000-0000-0000-000000000001', 'respinto-vecchio-320@test.it', '{"role":"seller"}'),
  ('e3200000-0000-0000-0000-000000000002', 'respinto-ieri-320@test.it',    '{"role":"seller"}'),
  ('e3200000-0000-0000-0000-000000000003', 'respinto-prima-320@test.it',   '{"role":"rider"}');

UPDATE public.profiles
   SET approval_status = 'rejected', is_approved = false,
       rejected_at = now() - interval '100 days', approved_at = now() - interval '1 day',
       kyc_id_doc_front_url = 'kyc/e32-1/fronte.jpg'
 WHERE id = 'e3200000-0000-0000-0000-000000000001';

UPDATE public.profiles
   SET approval_status = 'rejected', is_approved = false,
       rejected_at = now() - interval '1 day', approved_at = now() - interval '800 days',
       kyc_id_doc_front_url = 'kyc/e32-2/fronte.jpg'
 WHERE id = 'e3200000-0000-0000-0000-000000000002';

UPDATE public.profiles
   SET approval_status = 'rejected', is_approved = false,
       rejected_at = NULL, approved_at = now() - interval '120 days',
       rider_license_url = 'kyc/e32-3/patente.jpg'
 WHERE id = 'e3200000-0000-0000-0000-000000000003';

CREATE TEMP TABLE potati ON COMMIT DROP AS
SELECT user_id FROM public.documenti_da_cancellare_respinti(90)
 WHERE user_id::text LIKE 'e3200000-%';

INSERT INTO esiti SELECT '① respinto 100 giorni fa (approvato ieri) si pota',
  EXISTS (SELECT 1 FROM potati WHERE user_id = 'e3200000-0000-0000-0000-000000000001'), '';
INSERT INTO esiti SELECT '② approvato anni fa e respinto ieri NON si pota',
  NOT EXISTS (SELECT 1 FROM potati WHERE user_id = 'e3200000-0000-0000-0000-000000000002'), '';
INSERT INTO esiti SELECT '③ respinto prima della 320 (solo approved_at) si pota ancora',
  EXISTS (SELECT 1 FROM potati WHERE user_id = 'e3200000-0000-0000-0000-000000000003'), '';
INSERT INTO esiti SELECT '② i documenti di chi è respinto da ieri restano',
  (SELECT kyc_id_doc_front_url FROM public.profiles WHERE id = 'e3200000-0000-0000-0000-000000000002') IS NOT NULL, '';

-- ④ la persona stessa non scrive rejected_at
RESET mycity.allow_profile_write;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e3200000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles SET rejected_at = now() - interval '1000 days'
     WHERE id = 'e3200000-0000-0000-0000-000000000002';
    INSERT INTO esiti VALUES ('④ una persona non si scrive rejected_at', false, 'l''update è passato');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('④ una persona non si scrive rejected_at', true, '');
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
