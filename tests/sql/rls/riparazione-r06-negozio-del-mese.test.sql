-- =============================================================================
-- R06-014 (12/11/2026) — La classifica del negozio del mese usa il mese di Piacenza
-- =============================================================================
-- Prova leggera (now() non si può fingere in SQL): la vista calcola il mese nel
-- fuso Europe/Rome, conta un voto dato nel mese di Piacenza e ha tenuto le
-- opzioni di sicurezza di prima. Senza la migrazione 301 questo file è ROSSO.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES
  ('a0600000-0000-0000-0000-000000000201', 'forno-r06-mese@test.it', '{"role":"seller"}', now()),
  ('a0600000-0000-0000-0000-000000000202', 'maria-r06-mese@test.it', '{"role":"buyer"}',  now());
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Forno R06'
 WHERE id = 'a0600000-0000-0000-0000-000000000201';

INSERT INTO public.shop_of_month_votes (voter_id, seller_id, month)
VALUES ('a0600000-0000-0000-0000-000000000202', 'a0600000-0000-0000-0000-000000000201',
        date_trunc('month', now() AT TIME ZONE 'Europe/Rome')::date);

INSERT INTO esiti
SELECT 'la vista prende il mese nel fuso di Piacenza',
       pg_get_viewdef('public.shop_of_month_leaderboard'::regclass) ILIKE '%Europe/Rome%',
       left(regexp_replace(pg_get_viewdef('public.shop_of_month_leaderboard'::regclass), '\s+', ' ', 'g'), 200);

INSERT INTO esiti
SELECT 'il mese della vista e'' quello di Piacenza',
       (SELECT month FROM public.shop_of_month_leaderboard WHERE seller_id = 'a0600000-0000-0000-0000-000000000201')
         = date_trunc('month', now() AT TIME ZONE 'Europe/Rome')::date,
       'mese=' || coalesce((SELECT month::text FROM public.shop_of_month_leaderboard WHERE seller_id = 'a0600000-0000-0000-0000-000000000201'), 'nessuna riga');

INSERT INTO esiti
SELECT 'il voto del mese di Piacenza si conta',
       (SELECT vote_count FROM public.shop_of_month_leaderboard WHERE seller_id = 'a0600000-0000-0000-0000-000000000201') = 1,
       'voti=' || coalesce((SELECT vote_count::text FROM public.shop_of_month_leaderboard WHERE seller_id = 'a0600000-0000-0000-0000-000000000201'), 'nessuna riga');

INSERT INTO esiti
SELECT 'la vista tiene security_invoker=off e security_barrier=true',
       (SELECT reloptions @> ARRAY['security_invoker=off', 'security_barrier=true'] FROM pg_class WHERE oid = 'public.shop_of_month_leaderboard'::regclass),
       (SELECT reloptions::text FROM pg_class WHERE oid = 'public.shop_of_month_leaderboard'::regclass);

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
