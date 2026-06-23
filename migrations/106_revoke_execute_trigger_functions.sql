-- 106_revoke_execute_trigger_functions.sql
-- Hardening (security advisor 0028/0029): alcune funzioni-TRIGGER SECURITY
-- DEFINER risultavano ESEGUIBILI come RPC da anon/authenticated via PostgREST
-- (/rest/v1/rpc/<fn>). Sono funzioni interne a 0 argomenti, invocate SOLO dai
-- trigger: i trigger scattano a prescindere dai grant EXECUTE sulla funzione,
-- quindi revocare l'EXECUTE è sicuro e chiude la superficie RPC inutile.
--
-- ⚠️ NON includere touch_loyalty_streak(): è una RPC VOLUTA, chiamata dall'app
--    (lib/loyalty.ts → supabase.rpc('touch_loyalty_streak')). Revocarla romperebbe
--    il check-in giornaliero loyalty.
--
-- Idempotente: REVOKE su grant assenti è no-op.

REVOKE EXECUTE ON FUNCTION public.notify_buyer_on_order_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reward_referrer_on_delivery()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_review_helpful_count()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_activity_change()           FROM PUBLIC, anon, authenticated;
