-- 067: revoca `anon` dalle funzioni SECURITY DEFINER di integrità ordine
--
-- Security advisor 0028: cancel_order, seller_reject_order, rider_release_order,
-- verify_pickup_code, verify_delivery_code restavano chiamabili da `anon` via
-- PostgREST (/rest/v1/rpc/...). Vanno chiuse ad anon.
--
-- ATTENZIONE (correzione rispetto a una prima stesura errata): queste funzioni
-- NON sono server-only. Sono invocate CLIENT-SIDE come `authenticated`:
--   * cancel_order        -> app/orders/[id]/page.tsx          (acquirente)
--   * seller_reject_order  -> app/seller/orders/[id]/page.tsx   (venditore)
--   * rider_release_order  -> app/rider/orders/[id]/page.tsx    (rider)
--   * verify_pickup_code   -> app/rider/orders/[id]/page.tsx    (rider)
--   * verify_delivery_code -> app/rider/orders/[id]/page.tsx    (rider)
-- Tutte applicano internamente il controllo auth.uid() (rider_id/seller_id/
-- acquirente) + lockout, quindi `authenticated` è sicuro e necessario.
-- REVOCARE `authenticated` romperebbe i bottoni rifiuta/rilascia e la conferma
-- ritiro/consegna del rider. Si revoca SOLO `anon` (e PUBLIC), si mantiene
-- `authenticated` + `service_role`.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'cancel_order', 'seller_reject_order', 'rider_release_order',
        'verify_pickup_code', 'verify_delivery_code'
      )
  LOOP
    -- toglie l'accesso a chiunque non loggato; PUBLIC include anon
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    -- ripristina esplicitamente i ruoli legittimi (idempotente)
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
