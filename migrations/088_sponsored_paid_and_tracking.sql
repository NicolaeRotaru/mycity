-- 088_sponsored_paid_and_tracking.sql
--
-- Prodotti sponsorizzati: SOLO a pagamento + tracciamento reale di
-- visualizzazioni/click.
--
-- Prima: la policy `sponsored_listings_owner_rw` (FOR ALL su seller_id) permetteva
-- a un venditore di INSERIRE una campagna `status='active'` da solo, senza pagare
-- (auto-promozione gratis). Inoltre il carosello non registrava impressions/clicks
-- → le statistiche admin restavano a zero.
--
-- Ora: la campagna si crea SOLO server-side dopo il pagamento Stripe (webhook,
-- service role). Il venditore può solo LEGGERE le proprie; l'admin gestisce via
-- is_admin(). Le RPC di tracking incrementano i contatori (anche per ospiti).
--
-- Idempotente.

-- Idempotenza creazione via webhook: una campagna per sessione Stripe.
ALTER TABLE public.sponsored_listings ADD COLUMN IF NOT EXISTS stripe_session_id text;
CREATE UNIQUE INDEX IF NOT EXISTS sponsored_listings_session_uidx
  ON public.sponsored_listings(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- RLS: niente più auto-attivazione gratuita.
DROP POLICY IF EXISTS sponsored_listings_owner_rw ON public.sponsored_listings;
DROP POLICY IF EXISTS sponsored_listings_owner_read ON public.sponsored_listings;
CREATE POLICY sponsored_listings_owner_read ON public.sponsored_listings
  FOR SELECT USING ((select auth.uid()) = seller_id);

DROP POLICY IF EXISTS sponsored_listings_admin_all ON public.sponsored_listings;
CREATE POLICY sponsored_listings_admin_all ON public.sponsored_listings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
-- `sponsored_listings_public_read` (status='active') resta invariata.

-- Tracciamento: incrementa SOLO su campagne attive. Chiamabile anche da ospiti
-- (le impression avvengono per chiunque veda il carosello).
CREATE OR REPLACE FUNCTION public.track_sponsored_impression(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sponsored_listings SET impressions = impressions + 1 WHERE id = p_id AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.track_sponsored_click(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sponsored_listings SET clicks = clicks + 1 WHERE id = p_id AND status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION public.track_sponsored_impression(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.track_sponsored_click(uuid)      FROM public;
GRANT EXECUTE ON FUNCTION public.track_sponsored_impression(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_sponsored_click(uuid)      TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
