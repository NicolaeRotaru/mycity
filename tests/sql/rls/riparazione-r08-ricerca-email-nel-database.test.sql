-- =============================================================================
-- R08-003 (26/11/2026) — Una ricerca per email nel pannello utenti non si porta
-- a casa tutte le email degli iscritti
-- =============================================================================
-- /admin/users cercava l'email chiedendo tutto auth.users e filtrando nel
-- browser. Qui si fa la stessa domanda che fa la pagina per UNA ricerca: la
-- forma con la ricerca (testo, id già trovati) se il database ce l'ha, se no
-- quella su cui la pagina ripiega (tutte le email). Il database deve
-- restituire solo chi corrisponde. Senza la migrazione 940 questo file è ROSSO.
--
-- E, visto che sono email: nessuna forma della funzione è eseguibile da PUBLIC
-- o da anon, tutte sono SECURITY DEFINER con search_path fisso, e un utente
-- che non è amministratore riceve 42501, non una riga.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, phone, raw_user_meta_data, email_confirmed_at) VALUES
  ('a0800000-0000-0000-0000-000000000001', 'capo-r08@test.it',                     NULL,            '{"role":"admin"}', now()),
  ('a0800000-0000-0000-0000-000000000002', 'maria-r08@test.it',                    NULL,            '{"role":"buyer"}', now()),
  ('a0800000-0000-0000-0000-000000000003', 'Gabriella.Bertorelli.R08@piacenza.it', NULL,            '{"role":"buyer"}', now()),
  ('a0800000-0000-0000-0000-000000000004', 'gabriele-r08@altro.it',                '+390523987654', '{"role":"buyer"}', now()),
  ('a0800000-0000-0000-0000-000000000005', 'forno-r08@test.it',                    NULL,            '{"role":"seller"}', now());
UPDATE public.profiles SET role = 'admin' WHERE id = 'a0800000-0000-0000-0000-000000000001';

CREATE TEMP TABLE iscritti ON COMMIT DROP AS SELECT count(*)::int AS n FROM auth.users;
GRANT SELECT ON iscritti TO anon, authenticated;

-- ── ① I permessi di ogni forma della funzione (guardati nel catalogo) ─────────
INSERT INTO esiti
SELECT 'admin_list_user_emails: ogni forma è SECURITY DEFINER con search_path fisso',
       count(*) > 0 AND bool_and(p.prosecdef AND coalesce(p.proconfig::text, '') LIKE '%search_path=%'),
       string_agg(p.oid::regprocedure::text, ', ')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_list_user_emails';

INSERT INTO esiti
SELECT 'admin_list_user_emails: nessuna forma è eseguibile da PUBLIC o da anon',
       count(*) > 0 AND bool_and(
         p.proacl IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
       string_agg(p.oid::regprocedure::text || ' acl=' || coalesce(p.proacl::text, 'predefinita'), ', ')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_list_user_emails';

-- ── ② Un amministratore cerca per email, come la pagina ───────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0800000-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  con_ricerca boolean := to_regprocedure('public.admin_list_user_emails(text,uuid[])') IS NOT NULL;
  tutti int := (SELECT n FROM iscritti);
  n int; giusti int; msg text;
BEGIN
  BEGIN
    IF con_ricerca THEN
      EXECUTE 'SELECT count(*)::int, count(*) FILTER (WHERE email = ''Gabriella.Bertorelli.R08@piacenza.it'')::int
                 FROM public.admin_list_user_emails($1, $2)'
        INTO n, giusti USING 'bertorelli.r08', ARRAY[]::uuid[];
    ELSE
      -- La strada su cui la pagina ripiega: tutte le email, filtrate poi nel browser.
      SELECT count(*)::int, count(*) FILTER (WHERE email = 'Gabriella.Bertorelli.R08@piacenza.it')::int
        INTO n, giusti FROM public.admin_list_user_emails();
    END IF;
    INSERT INTO esiti VALUES (
      'una ricerca per email riceve dal database solo chi corrisponde, non tutte le email',
      n = 1 AND giusti = 1,
      format('righe arrivate=%s (giuste=%s) su %s iscritti', n, giusti, tutti));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO esiti VALUES ('una ricerca per email riceve dal database solo chi corrisponde, non tutte le email', false, msg);
  END;

  IF NOT con_ricerca THEN RETURN; END IF;

  -- Il telefono si cerca come l'email; maiuscole e minuscole non contano.
  EXECUTE 'SELECT count(*)::int FROM public.admin_list_user_emails($1, $2) WHERE id = ''a0800000-0000-0000-0000-000000000004'''
    INTO n USING '0523987', ARRAY[]::uuid[];
  INSERT INTO esiti VALUES ('si trova anche per telefono', n = 1, format('righe=%s', n));

  -- `%` e `_` non sono jolly: «r08%» non tira fuori tutti quelli con «r08».
  EXECUTE 'SELECT count(*)::int FROM public.admin_list_user_emails($1, $2)' INTO n USING 'r08%', ARRAY[]::uuid[];
  INSERT INTO esiti VALUES ('un «%» scritto nella casella non allarga la ricerca a tutti', n = 0, format('righe=%s', n));
  EXECUTE 'SELECT count(*)::int FROM public.admin_list_user_emails($1, $2)' INTO n USING 'r_8', ARRAY[]::uuid[];
  INSERT INTO esiti VALUES ('un «_» scritto nella casella vale come lettera', n = 0, format('righe=%s', n));

  -- Gli id dei profili già trovati per nome riportano il loro contatto, e solo quello.
  EXECUTE 'SELECT count(*)::int FROM public.admin_list_user_emails($1, $2)'
    INTO n USING 'bertorelli.r08', ARRAY['a0800000-0000-0000-0000-000000000005']::uuid[];
  INSERT INTO esiti VALUES ('gli id già trovati per nome aggiungono il loro contatto', n = 2, format('righe=%s', n));

  -- Sotto le due lettere non si cerca niente: tornano solo i contatti degli id dati.
  EXECUTE 'SELECT count(*)::int FROM public.admin_list_user_emails($1, $2)'
    INTO n USING 'r', ARRAY['a0800000-0000-0000-0000-000000000005']::uuid[];
  INSERT INTO esiti VALUES ('sotto le due lettere non si cerca: solo gli id dati', n = 1, format('righe=%s', n));
END $$;

-- ── ③ Un cliente qualunque non legge nessuna email ────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"a0800000-0000-0000-0000-000000000002","role":"authenticated"}';

DO $$
DECLARE n int; stato text;
BEGIN
  IF to_regprocedure('public.admin_list_user_emails(text,uuid[])') IS NULL THEN RETURN; END IF;
  BEGIN
    EXECUTE 'SELECT count(*)::int FROM public.admin_list_user_emails($1, $2)' INTO n USING 'r08', ARRAY[]::uuid[];
    INSERT INTO esiti VALUES ('un utente che non è amministratore non può cercare le email', false, format('ha ricevuto %s righe', n));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS stato = RETURNED_SQLSTATE;
    INSERT INTO esiti VALUES ('un utente che non è amministratore non può cercare le email', stato = '42501', 'sqlstate=' || stato);
  END;
END $$;

-- ── ④ Chi non ha fatto l'accesso nemmeno ──────────────────────────────────────
RESET request.jwt.claims;
SET LOCAL ROLE anon;

DO $$
DECLARE n int; stato text;
BEGIN
  IF to_regprocedure('public.admin_list_user_emails(text,uuid[])') IS NULL THEN RETURN; END IF;
  BEGIN
    EXECUTE 'SELECT count(*)::int FROM public.admin_list_user_emails($1, $2)' INTO n USING 'r08', ARRAY[]::uuid[];
    INSERT INTO esiti VALUES ('chi non ha fatto l''accesso non può cercare le email', false, format('ha ricevuto %s righe', n));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS stato = RETURNED_SQLSTATE;
    INSERT INTO esiti VALUES ('chi non ha fatto l''accesso non può cercare le email', stato = '42501', 'sqlstate=' || stato);
  END;
END $$;

RESET ROLE;

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
