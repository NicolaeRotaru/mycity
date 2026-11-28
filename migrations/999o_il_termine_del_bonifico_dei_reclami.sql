-- 999o — Il bonifico di rimborso di un reclamo ha un giorno da cui contare i 14 giorni (R05-004, 28/11/2026).
--
-- Il difetto. La 910 elenca i bonifici di rimborso da fare a mano (ordini in contanti) e, per un
-- reso, il giorno in cui il cliente l'ha chiesto: da lì contano i 14 giorni, e il sorvegliante
-- (app/api/cron/operational-alerts) avvisa a 3 giorni o meno dal termine e a termine passato. Per un
-- bonifico nato da un reclamo (`dispute_<id>`) la 910 non dava nessun giorno: termine «sconosciuto»,
-- in evidenza sulla pagina solo per chi la apre, e nessun allarme lo guardava mai.
--
-- COSA FA. `admin_bonifici_rimborso()` restituisce, accanto alle colonne della 910 (che restano
-- uguali, `chiesto_il` compreso: per un reclamo resta vuota), due colonne nuove per i reclami:
--   · reclamo_aperto_il  — disputes.created_at, quando il cliente ha aperto il reclamo;
--   · reclamo_deciso_il  — disputes.resolved_at, quando l'amministrazione l'ha deciso.
-- Da quale dei due si contano i 14 giorni lo dice il codice, in un posto solo:
-- PARTENZA_DEL_TERMINE_DEI_RECLAMI in lib/rimborsi/bonifici-da-fare.ts (oggi «apertura», il termine
-- più presto: l'allarme non arriva mai tardi). DOMANDA APERTA A NICOLA: per un reclamo i 14 giorni
-- partono dall'apertura? Se dice di no, si cambia quella costante e qui non si tocca niente.
--
-- Il tipo della funzione cambia (due colonne in più): CREATE OR REPLACE non basta, si toglie e si
-- rimette, con gli stessi permessi e lo stesso controllo dentro (solo amministratori o il server).
-- Si può rieseguire. Vuole la 910 (private.bonifici_rimborso): senza, si ferma e lo dice.
-- Prova: tests/sql/rls/riparazione-onda2-r05-004-termine-dei-reclami.test.sql.
-- NON si applica a mano: lo decide Nicola.
-- REVERSIBILE: rieseguire la sezione 2 della migrazione 910 dopo
--   DROP FUNCTION IF EXISTS public.admin_bonifici_rimborso();

BEGIN;

DO $$
BEGIN
  IF to_regclass('private.bonifici_rimborso') IS NULL THEN
    RAISE EXCEPTION '999o: manca private.bonifici_rimborso, applica prima la migrazione 910';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.admin_bonifici_rimborso();

CREATE FUNCTION public.admin_bonifici_rimborso()
RETURNS TABLE (
  order_id uuid,
  chiave text,
  centesimi integer,
  cliente_nome text,
  cliente_email text,
  chiesto_il timestamptz,
  stato text,
  fatto_da_nome text,
  fatto_il timestamptz,
  respinto_da_nome text,
  respinto_il timestamptz,
  reclamo_aperto_il timestamptz,
  reclamo_deciso_il timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role') THEN
    RAISE EXCEPTION 'bonifici di rimborso: riservato agli amministratori' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT o.id,
           m[2],
           m[1]::int,
           coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(o.delivery_full_name), '')),
           u.email::text,
           r.created_at,
           coalesce(b.stato, 'DA_FARE'),
           pf.full_name,
           b.fatto_il,
           pr.full_name,
           b.respinto_il,
           d.created_at,
           d.resolved_at
      FROM public.orders o
      CROSS JOIN LATERAL regexp_split_to_table(o.stripe_refund_id, ',') AS s(segno)
      CROSS JOIN LATERAL regexp_match(btrim(s.segno), '^bonifico:([0-9]+):(.+)$') AS m
      LEFT JOIN private.bonifici_rimborso b ON b.chiave = m[2] AND b.order_id = o.id
      LEFT JOIN public.returns r ON m[2] = 'return_' || r.id::text AND r.order_id = o.id
      LEFT JOIN public.disputes d ON m[2] = 'dispute_' || d.id::text AND d.order_id = o.id
      LEFT JOIN public.profiles p ON p.id = o.user_id
      LEFT JOIN auth.users u ON u.id = o.user_id
      LEFT JOIN public.profiles pf ON pf.id = b.fatto_da
      LEFT JOIN public.profiles pr ON pr.id = b.respinto_da
     WHERE o.stripe_refund_id LIKE '%bonifico:%'
       AND length(m[1]) <= 9;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_bonifici_rimborso() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_bonifici_rimborso() FROM anon;
-- Il controllo vero è dentro: la pagina la chiama con la sessione dell'amministratore, il sorvegliante col server.
GRANT EXECUTE ON FUNCTION public.admin_bonifici_rimborso() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_bonifici_rimborso() IS
  'I bonifici di rimborso scritti sugli ordini (segno bonifico:<centesimi>:<chiave>), con l esito (DA_FARE, FATTO, RESPINTO), il cliente, per i resi il giorno della richiesta e per i reclami quando è stato aperto e deciso. Solo amministratori o il server (migrazioni 910 e 999o).';

COMMIT;

NOTIFY pgrst, 'reload schema';
