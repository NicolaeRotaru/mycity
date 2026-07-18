-- Fix #36: race condition sui coupon — claim atomico.
-- Prima: validateCoupon leggeva uses_count poi increment_coupon_usage incrementava dopo.
-- Due richieste parallele potevano entrambe passare la validazione e over-consumare il coupon.
-- Ora: claim_coupon fa check + increment in un singolo UPDATE atomico (row-level lock).
-- Ritorna true se il claim è andato a buon fine, false se il coupon era già esaurito.

CREATE OR REPLACE FUNCTION public.claim_coupon(p_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE public.coupons
       SET uses_count = COALESCE(uses_count, 0) + 1
     WHERE code = upper(trim(p_code))
       AND active = true
       AND (max_uses IS NULL OR uses_count < max_uses)
    RETURNING id
  )
  SELECT EXISTS(SELECT 1 FROM updated);
$$;

REVOKE ALL ON FUNCTION public.claim_coupon(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.claim_coupon(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_coupon(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coupon(text) TO service_role;
