-- =============================================================================
-- 051 — Collassa il doppio wrap di (select auth.uid()) nelle policy RLS
-- =============================================================================
-- Durante l'ottimizzazione initplan alcune policy sono state avvolte due volte
-- → "( SELECT ( SELECT auth.uid() AS uid) AS uid)". È semanticamente identico
-- (subquery scalari annidate, stesso valore) ma ridondante. Qui collassiamo al
-- singolo wrap "( SELECT auth.uid() AS uid)" sostituendo la stringa letterale
-- interna (niente regex/backslash). Idempotente: agisce solo sulle policy
-- doppiamente avvolte; su un DB pulito (dove 050 wrappa una sola volta) è no-op.
DO $$
DECLARE r record; nq text; nc text; stmt text;
BEGIN
  FOR r IN
    SELECT policyname, tablename, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual LIKE '%( SELECT ( SELECT auth.uid() AS uid) AS uid)%'
        OR with_check LIKE '%( SELECT ( SELECT auth.uid() AS uid) AS uid)%')
  LOOP
    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF r.qual IS NOT NULL THEN
      nq := replace(r.qual, '( SELECT auth.uid() AS uid)', 'auth.uid()');
      stmt := stmt || ' USING (' || nq || ')';
    END IF;
    IF r.with_check IS NOT NULL THEN
      nc := replace(r.with_check, '( SELECT auth.uid() AS uid)', 'auth.uid()');
      stmt := stmt || ' WITH CHECK (' || nc || ')';
    END IF;
    EXECUTE stmt;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
