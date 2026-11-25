-- =============================================================================
-- 862 — Il profilo lo crea solo la registrazione, non il browser
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Il difetto: la guardia sui profili (`enforce_profile_update_rules`) scatta solo
-- quando una riga si CAMBIA. Sull'inserimento c'era solo la regola «Profile is
-- created on signup», che controllava una cosa sola: che l'id fosse il proprio.
-- Un utente collegato SENZA riga in `profiles` poteva quindi crearsela dal
-- browser con `role = 'admin'` e `is_approved = true`.
--
--   ① un utente collegato senza riga non si crea un profilo da admin;
--   ② e nemmeno un profilo qualunque da cliente: dal browser non si inserisce;
--   ③ un visitatore senza account non inserisce profili;
--   ④ dopo i tentativi, in banca dati quell'utente non ha nessuna riga;
--   ⑤ la registrazione crea ancora la riga, da cliente anche se chiede «admin»;
--   ⑥ il server (chiave di servizio) inserisce ancora un profilo;
--   ⑦ chi ha già la riga cambia ancora il proprio telefono;
--   ⑧ nessun permesso né regola di inserimento su `profiles` per anon e authenticated.
-- Senza la migrazione 862 ①, ②, ④ e ⑧ sono ROSSI (provato: ① crea la riga admin|true|approved).
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- Cinque account. Quattro restano SENZA riga in profiles: e' il caso che apre la
-- porta (riga cancellata, trigger fallito, utente nato prima del trigger). Uno
-- per controllo, cosi' un inserimento passato non ne sporca un altro.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e8620000-0000-0000-0000-000000000001', 'senza-riga-862@test.it',   '{"role":"buyer"}'),
  ('e8620000-0000-0000-0000-000000000002', 'con-riga-862@test.it',     '{"role":"buyer"}'),
  ('e8620000-0000-0000-0000-000000000003', 'server-862@test.it',       '{"role":"buyer"}'),
  ('e8620000-0000-0000-0000-000000000005', 'senza-riga-2-862@test.it', '{"role":"buyer"}'),
  ('e8620000-0000-0000-0000-000000000006', 'senza-riga-3-862@test.it', '{"role":"buyer"}');
DELETE FROM public.profiles
 WHERE id IN ('e8620000-0000-0000-0000-000000000001', 'e8620000-0000-0000-0000-000000000003',
              'e8620000-0000-0000-0000-000000000005', 'e8620000-0000-0000-0000-000000000006');
RESET mycity.allow_profile_write;

-- Prova un inserimento: vero se passa, falso se il database lo ferma per permessi.
-- Ogni altro errore risale e fa fallire il file: non deve sembrare una porta chiusa.
CREATE FUNCTION pg_temp.inserisce(utente uuid, ruolo text, approvato boolean, stato text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.profiles (id, role, is_approved, approval_status, referral_code)
  VALUES (utente, ruolo, approvato, stato, upper(substr(md5(utente::text), 1, 8)));
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.inserisce(uuid, text, boolean, text) TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.cambia_telefono(utente uuid, valore text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.profiles SET phone = valore WHERE id = utente;
  RETURN FOUND;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.cambia_telefono(uuid, text) TO authenticated;

-- ── Dal browser, con la chiave pubblica ─────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e8620000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti VALUES ('1 un utente senza riga non si crea un profilo da admin',
  NOT pg_temp.inserisce('e8620000-0000-0000-0000-000000000001', 'admin', true, 'approved'), '');
SET LOCAL request.jwt.claims = '{"sub":"e8620000-0000-0000-0000-000000000005","role":"authenticated"}';
INSERT INTO esiti VALUES ('2 e nemmeno un profilo da cliente: dal browser non si inserisce',
  NOT pg_temp.inserisce('e8620000-0000-0000-0000-000000000005', 'buyer', false, 'pending'), '');

SET LOCAL request.jwt.claims = '{"sub":"e8620000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti VALUES ('7 chi ha gia la riga cambia ancora il proprio telefono',
  pg_temp.cambia_telefono('e8620000-0000-0000-0000-000000000002', '0523111222'), '');
RESET ROLE;

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
INSERT INTO esiti VALUES ('3 un visitatore senza account non inserisce profili',
  NOT pg_temp.inserisce('e8620000-0000-0000-0000-000000000006', 'admin', true, 'approved'), '');
RESET ROLE;
RESET request.jwt.claims;

INSERT INTO esiti SELECT '4 in banca dati l utente senza riga non ha nessun profilo', count(*) = 0,
  coalesce(string_agg(role || '|' || is_approved || '|' || coalesce(approval_status, '-'), ', '), 'nessuna riga')
  FROM public.profiles WHERE id = 'e8620000-0000-0000-0000-000000000001';

-- ── La registrazione: il trigger su auth.users crea ancora la riga ──────────
INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES ('e8620000-0000-0000-0000-000000000004', 'nuovo-862@test.it', '{"role":"admin"}');
INSERT INTO esiti SELECT '5 la registrazione crea ancora la riga, da cliente anche se chiede admin',
  count(*) = 1 AND bool_and(role = 'buyer' AND is_approved = false),
  coalesce(string_agg(role || '|' || is_approved, ', '), 'nessuna riga')
  FROM public.profiles WHERE id = 'e8620000-0000-0000-0000-000000000004';

-- ── Il server: la chiave di servizio (es. /api/agenzia/nuova-attivita) ─────
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti VALUES ('6 il server inserisce ancora un profilo',
  pg_temp.inserisce('e8620000-0000-0000-0000-000000000003', 'seller', false, 'pending'), '');
RESET ROLE;
RESET request.jwt.claims;

-- ── La forma: nessuno strato di inserimento lasciato ai ruoli pubblici ──────
-- Un permesso (anche su una sola colonna) o una regola permissiva che li copre:
-- se una migrazione futura li rimette, questo controllo torna rosso.
INSERT INTO esiti SELECT '8 nessun permesso ne regola di inserimento per anon e authenticated',
  count(*) = 0, coalesce(string_agg(x, ', '), '')
  FROM (
    SELECT r || ' ha il permesso INSERT' AS x
      FROM unnest(ARRAY['anon', 'authenticated']) AS r
     WHERE has_table_privilege(r, 'public.profiles', 'INSERT')
        OR has_any_column_privilege(r, 'public.profiles', 'INSERT')
    UNION ALL
    SELECT 'regola «' || policyname || '» per ' || array_to_string(roles, ',')
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'profiles'
       AND cmd IN ('INSERT', 'ALL') AND permissive = 'PERMISSIVE'
       AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ) s;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi: dal browser ci si crea un profilo da soli', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'il profilo lo crea solo la registrazione: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
