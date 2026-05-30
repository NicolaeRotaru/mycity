-- 060: Hardening product_views — integrità analytics (audit punto 1.2)
-- Esperti senior consultati:
-- - Security Engineer: "La policy INSERT era WITH CHECK (true): un utente poteva
--    (a) attribuire view ad altri user_id e (b) gonfiare i contatori per far
--    'trendare' un prodotto. Restringiamo l'attribuzione a se stessi/guest e
--    deduplichiamo le view degli utenti loggati lato server (1/ora per prodotto)."
-- - Data Analyst: "Dedup server-side = TrendingNow più affidabile, non manipolabile
--    bypassando il sessionStorage del client."
-- NOTA: per i guest (user_id NULL) non è possibile deduplicare a livello DB senza
-- un IP (non presente in tabella). Il tracciamento view resta best-effort lato
-- client; questa migration chiude l'attribuzione fraudolenta e l'inflation dei loggati.

-- 1. Restringe l'INSERT: solo view proprie o anonime (mai a nome di altri)
DROP POLICY IF EXISTS pv_insert_any ON public.product_views;
CREATE POLICY pv_insert_own_or_guest ON public.product_views
  FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));

-- 2. Dedup server-side: max 1 view per (utente, prodotto) ogni ora.
-- SECURITY DEFINER per poter leggere la tabella nel check anche sotto RLS.
CREATE OR REPLACE FUNCTION public.product_views_dedup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.product_views
    WHERE user_id = NEW.user_id
      AND product_id = NEW.product_id
      AND viewed_at > now() - interval '1 hour'
  ) THEN
    RETURN NULL; -- salta silenziosamente il duplicato (no inflation, no errore)
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_views_dedup ON public.product_views;
CREATE TRIGGER trg_product_views_dedup
  BEFORE INSERT ON public.product_views
  FOR EACH ROW
  EXECUTE FUNCTION public.product_views_dedup();
