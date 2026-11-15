-- =============================================================================
-- R18-016 · Il nome scritto alla registrazione resta nel profilo
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: la registrazione mette il nome nei dati dell'account
-- (raw_user_meta_data.full_name), ma il grilletto handle_new_user (161:97-118)
-- creava il profilo senza: ogni cliente nasceva senza nome.
--
-- Qui l'iscrizione si simula come la fa Supabase (e come la imita
-- tests/sql/harness/00_shim_supabase.sql): una riga in auth.users coi dati
-- dell'account, e il grilletto on_auth_user_created crea il profilo. Poi si
-- guarda il profilo che nasce.
--
-- Il nome copiato arriva anche alla classifica degli inviti: un altro utente
-- deve vederci solo il nome di battesimo, come negli altri nomi pubblici.
-- Senza la 421 è rossa. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO authenticated;

-- L'iscrizione: i dati dell'account sono quelli che manda app/sign-up/page.tsx.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1816000-0000-0000-0000-000000000001', 'mario-r18n@test.it',
   '{"role":"buyer","full_name":"  Mario Rossi  ","versione_testi_accettati":"2026-10"}'),
  ('e1816000-0000-0000-0000-000000000002', 'senza-nome-r18n@test.it',
   '{"role":"buyer"}'),
  ('e1816000-0000-0000-0000-000000000003', 'spazi-r18n@test.it',
   '{"role":"buyer","full_name":"   "}'),
  ('e1816000-0000-0000-0000-000000000004', 'lungo-r18n@test.it',
   jsonb_build_object('role', 'buyer', 'full_name', repeat('A', 250))),
  ('e1816000-0000-0000-0000-000000000005', 'forno-r18n@test.it',
   '{"role":"seller","full_name":"Giulia Verdi"}'),
  ('e1816000-0000-0000-0000-000000000006', 'luca-r18n@test.it',
   '{"role":"buyer","full_name":"Luca Neri"}');

-- ── ① Il nome scritto alla registrazione è nel profilo ───────────────────
INSERT INTO esiti
SELECT '1 il nome scritto alla registrazione è nel profilo, senza spazi ai lati',
       full_name IS NOT DISTINCT FROM 'Mario Rossi', coalesce(full_name, '(vuoto)')
  FROM public.profiles WHERE id = 'e1816000-0000-0000-0000-000000000001';

-- ── ② Chi non scrive il nome (o scrive solo spazi) resta senza ───────────
INSERT INTO esiti
SELECT '2 senza nome, o con soli spazi, il profilo resta vuoto e non «   »',
       count(*) = 2 AND bool_and(full_name IS NULL), string_agg(coalesce(full_name, '(vuoto)'), ' | ')
  FROM public.profiles
 WHERE id IN ('e1816000-0000-0000-0000-000000000002', 'e1816000-0000-0000-0000-000000000003');

-- ── ③ Un nome lunghissimo si ferma a 200 caratteri ───────────────────────
INSERT INTO esiti
SELECT '3 un nome di 250 caratteri entra tagliato a 200',
       length(full_name) IS NOT DISTINCT FROM 200, coalesce(length(full_name)::text, '(vuoto)')
  FROM public.profiles WHERE id = 'e1816000-0000-0000-0000-000000000004';

-- ── ④ Il resto del profilo nasce come prima ──────────────────────────────
INSERT INTO esiti
SELECT '4 il negozio nasce negozio, non approvato e in attesa, col suo nome',
       role = 'seller' AND is_approved = false AND approval_status = 'pending'
         AND full_name IS NOT DISTINCT FROM 'Giulia Verdi' AND referral_code IS NOT NULL,
       format('%s · approvato %s · %s · %s', role, is_approved, approval_status, coalesce(full_name, '(vuoto)'))
  FROM public.profiles WHERE id = 'e1816000-0000-0000-0000-000000000005';

-- ── ⑤ Nella classifica degli inviti un altro vede solo il nome ───────────
-- Mario e Giulia hanno invitato qualcuno questo mese. Giulia il nome l'ha
-- scritto anche dal profilo, con il cognome.
SET LOCAL mycity.allow_profile_write = '1';
UPDATE public.profiles SET full_name = 'Giulia Verdi' WHERE id = 'e1816000-0000-0000-0000-000000000005';
RESET mycity.allow_profile_write;
INSERT INTO public.referrals (referrer_id, referred_id, status) VALUES
  ('e1816000-0000-0000-0000-000000000001', 'e1816000-0000-0000-0000-000000000002', 'signed_up'),
  ('e1816000-0000-0000-0000-000000000005', 'e1816000-0000-0000-0000-000000000003', 'signed_up');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1816000-0000-0000-0000-000000000006","role":"authenticated"}';
INSERT INTO esiti
SELECT '5 nella classifica degli inviti Luca vede i nomi di Mario e Giulia, non i cognomi',
       count(*) = 2
         AND bool_and(full_name IN ('Mario', 'Giulia'))
         AND NOT bool_or(coalesce(full_name, '') ~ '(Rossi|Verdi)'),
       coalesce(string_agg(coalesce(full_name, '(vuoto)'), ', ' ORDER BY full_name), '(nessuna riga)')
  FROM public.referral_leaderboard
 WHERE user_id IN ('e1816000-0000-0000-0000-000000000001', 'e1816000-0000-0000-0000-000000000005');
RESET ROLE;
RESET request.jwt.claims;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R18-016: % controllo/i rosso/i sul nome alla registrazione:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R18-016: il nome della registrazione arriva nel profilo (% controlli verdi)', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
