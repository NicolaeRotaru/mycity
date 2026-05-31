-- 067: completa il lockdown EXECUTE sulle funzioni SECURITY DEFINER mancanti
--
-- Security advisor (0028/0029): alcune funzioni SECURITY DEFINER restavano
-- chiamabili da `anon`/`authenticated` via PostgREST (/rest/v1/rpc/...),
-- bypassando le route server che fanno l'auth check. La migration 064 non le
-- copriva tutte:
--   - cancel_order, seller_reject_order: non erano nell'elenco di 064
--   - rider_release_order: creata DOPO (066) con il GRANT a PUBLIC di default
--
-- Verifica grant reali (has_function_privilege) prima del fix:
--   cancel_order        anon=t auth=t   seller_reject_order anon=t auth=t
--   rider_release_order anon=t auth=t
--
-- Regola:
--   * cancel_order  -> invocata dal CLIENT utente (OrderActions.tsx). Verifica
--     internamente auth.uid() = acquirente (FORBIDDEN altrimenti): resta a
--     `authenticated`, si toglie solo `anon`.
--   * seller_reject_order / rider_release_order / verify_*_code -> invocate SOLO
--     da route server (admin/service_role): si revoca anche `authenticated`.
--     verify_*_code sono incluse in modo idempotente (gia' chiuse da 064).

-- 1) cancel_order: utente loggato proprietario -> via anon, resta authenticated
REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated, service_role;

-- 2) funzioni server-only: solo service_role
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'seller_reject_order', 'rider_release_order',
        'verify_pickup_code', 'verify_delivery_code'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
