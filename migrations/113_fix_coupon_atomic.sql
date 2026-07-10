-- 113: rende l'incremento uso coupon atomico e condizionato
--
-- PROBLEMA: increment_coupon_usage (058) è UPDATE senza guardia su max_uses,
-- permettendo over-redemption in burst concorrente. Due checkout simultanei che
-- superano entrambi il check `uses_count < max_uses` in validateCoupon possono
-- entrambi incrementare, sfondando il limite.
--
-- FIX: la funzione diventa RETURNS boolean e aggiunge la WHERE-clause atomica:
--   AND (max_uses IS NULL OR uses_count < max_uses)
--   AND (valid_until IS NULL OR valid_until > now())
-- Restituisce TRUE se la riga è stata aggiornata, FALSE se il coupon era già
-- esaurito/scaduto al momento del lock. I caller (cod/route.ts e webhook/route.ts)
-- devono trattare FALSE come errore e non completare l'ordine.
--
-- Idempotente: CREATE OR REPLACE mantiene le stesse REVOKE/GRANT della 058.
-- Nota: cambia il tipo di ritorno da void a boolean; Supabase/PostgREST esegue
-- il replace automaticamente; se ci fosse una dipendenza dichiarata sulla firma
-- void sarebbe necessario un DROP preventivo — in questo schema non ci sono.

DROP FUNCTION IF EXISTS public.increment_coupon_usage(text);

CREATE OR REPLACE FUNCTION public.increment_coupon_usage(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.coupons
     SET uses_count = COALESCE(uses_count, 0) + 1
   WHERE code = upper(trim(p_code))
     AND is_active = true
     AND (max_uses IS NULL OR uses_count < max_uses)
     AND (valid_until IS NULL OR valid_until > now());
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- Ripristina i permessi: solo service_role (identici alla 058).
REVOKE ALL ON FUNCTION public.increment_coupon_usage(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.increment_coupon_usage(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_coupon_usage(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_coupon_usage(text) TO service_role;

NOTIFY pgrst, 'reload schema';
