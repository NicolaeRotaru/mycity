-- =============================================================================
-- 050 — Ottimizzazione auth_rls_initplan
-- =============================================================================
-- Le policy RLS che chiamano auth.uid()/auth.role()/auth.jwt()/auth.email()
-- direttamente vengono rivalutate UNA VOLTA PER RIGA. Avvolgendole in
-- (select auth.x()) Postgres le valuta una sola volta per query (initplan):
-- grande guadagno di performance sulle tabelle grandi.
--
-- La trasformazione è puramente SEMANTICA (la subquery scalare restituisce lo
-- stesso valore) → NON cambia il controllo accessi. Applicata leggendo le
-- espressioni dal catalogo (pg_policies) con replace() su stringa letterale
-- (niente regex/backslash) ed eseguendo ALTER POLICY. Idempotente: salta le
-- policy già avvolte in "select auth.".
DO $$
DECLARE r record; nq text; nc text; stmt text;
BEGIN
  FOR r IN
    SELECT policyname, tablename, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual LIKE '%auth.uid()%' OR qual LIKE '%auth.role()%'
        OR qual LIKE '%auth.jwt()%' OR qual LIKE '%auth.email()%'
        OR with_check LIKE '%auth.uid()%' OR with_check LIKE '%auth.role()%'
        OR with_check LIKE '%auth.jwt()%' OR with_check LIKE '%auth.email()%')
      AND COALESCE(qual, '') NOT LIKE '%select auth.%'
      AND COALESCE(with_check, '') NOT LIKE '%select auth.%'
  LOOP
    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF r.qual IS NOT NULL THEN
      nq := replace(replace(replace(replace(r.qual,
        'auth.uid()', '(select auth.uid())'),
        'auth.role()', '(select auth.role())'),
        'auth.jwt()', '(select auth.jwt())'),
        'auth.email()', '(select auth.email())');
      stmt := stmt || ' USING (' || nq || ')';
    END IF;
    IF r.with_check IS NOT NULL THEN
      nc := replace(replace(replace(replace(r.with_check,
        'auth.uid()', '(select auth.uid())'),
        'auth.role()', '(select auth.role())'),
        'auth.jwt()', '(select auth.jwt())'),
        'auth.email()', '(select auth.email())');
      stmt := stmt || ' WITH CHECK (' || nc || ')';
    END IF;
    EXECUTE stmt;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
