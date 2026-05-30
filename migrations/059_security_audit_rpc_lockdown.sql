-- 059: Security audit hardening — SECURITY DEFINER RPC lockdown + search_path
-- Esperti senior consultati:
-- - Security Engineer (OWASP A01 Broken Access Control / A04 Insecure Design):
--   "Diverse funzioni SECURITY DEFINER erano eseguibili da anon/authenticated e
--    NON validavano il chiamante. Le più gravi:
--      • award_loyalty_points(p_user, p_delta, ...) — un utente poteva chiamarla
--        dal browser e accreditarsi punti fedeltà ILLIMITATI (p_delta arbitrario).
--      • list_abandoned_carts_to_recover() — dump di email + nome + carrello di
--        fino a 100 utenti (data breach PII / GDPR).
--      • process_expired_deletions() / mark_abandoned_cart_email_sent() /
--        next_invoice_number() — operazioni backend esposte ai client.
--    Queste funzioni sono chiamate SOLO da endpoint server (service_role) o
--    internamente da trigger (PERFORM, contesto definer): revocare EXECUTE ad
--    anon/authenticated NON rompe i flussi legittimi e chiude l'escalation."
-- - DBA: "Le SECURITY DEFINER senza `SET search_path` sono soggette a schema
--    injection: fissare search_path = public."

-- =============================================================================
-- 1. search_path su funzioni SECURITY DEFINER che ne erano prive
-- =============================================================================
-- Tutte usano riferimenti già qualificati `public.` → fissare il path è sicuro.
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.update_group_quantity() SET search_path = public;
ALTER FUNCTION public.next_invoice_number(uuid, integer) SET search_path = public;

-- =============================================================================
-- 2. Restringe a service_role le RPC SECURITY DEFINER solo-backend
-- =============================================================================
-- award_loyalty_points: prima accreditava punti con p_user/p_delta arbitrari a
-- chiunque. Dopo questa migration l'unico accredito legittimo (bonus recensione
-- con foto) avviene server-side via trigger (sezione 3) in contesto definer.
REVOKE EXECUTE ON FUNCTION public.award_loyalty_points(uuid, integer, text, uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_achievement(uuid, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_abandoned_carts_to_recover(integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_abandoned_cart_email_sent(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_expired_deletions() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid, integer) FROM public, anon, authenticated;

-- =============================================================================
-- 3. Bonus fedeltà recensione-con-foto spostato server-side (anti-tamper)
-- =============================================================================
-- Sostituisce la chiamata browser `supabase.rpc('award_loyalty_points', {p_delta:20})`
-- (rimossa in app/product/[id]/page.tsx): ora l'accredito è un trigger che usa un
-- valore FISSO (+20) e l'utente reale della riga, non un importo scelto dal client.
CREATE OR REPLACE FUNCTION public.award_photo_review_bonus()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.photo_urls IS NOT NULL AND array_length(NEW.photo_urls, 1) > 0 THEN
    PERFORM public.award_loyalty_points(NEW.user_id, 20, 'review_with_photo', NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_photo_review_bonus ON public.reviews;
CREATE TRIGGER trg_award_photo_review_bonus
  AFTER INSERT ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.award_photo_review_bonus();
