-- 058: Marketplace security hardening — price/discount tampering (H1)
-- Esperti senior consultati:
-- - Security Engineer (OWASP A04 Insecure Design / A08 Data Integrity):
--   "Gli ordini COD venivano inseriti dal browser con total_price, shipping_cost
--    e discount_amount calcolati lato client, e la sola RLS `auth.uid() = user_id`
--    non verifica gli importi. Un utente poteva creare ordini con prezzo/sconto
--    arbitrari (pagare €0 alla consegna). Stesso problema per lo sconto coupon
--    inviato dal client al checkout Stripe."
-- - Backend Engineer: "La creazione ordini deve passare SOLO da endpoint server
--    (/api/orders/cod, webhook Stripe) che ricalcolano tutto dal DB con il client
--    service_role. Rimuovere le policy di INSERT per il ruolo authenticated chiude
--    definitivamente il vettore: il client non può più inserire ordini."
-- - Backend Engineer: "L'uso dei coupon (uses_count) deve essere incrementato
--    server-side in modo atomico, mai dal client, altrimenti max_uses è aggirabile."

-- =============================================================================
-- 1. RPC atomica per tracciare l'uso di un coupon (server-side authoritative)
-- =============================================================================
-- Chiamata da /api/orders/cod e dal webhook Stripe (entrambi con service_role)
-- dopo che gli ordini sono stati creati. SECURITY DEFINER + esecuzione ristretta
-- a service_role così che un utente non possa esaurire un coupon (max_uses) a
-- piacimento.

CREATE OR REPLACE FUNCTION public.increment_coupon_usage(p_code text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.coupons
     SET uses_count = COALESCE(uses_count, 0) + 1
   WHERE code = upper(trim(p_code));
$$;

-- NB: Supabase concede EXECUTE di default ai ruoli anon/authenticated alla
-- creazione di una funzione; il solo REVOKE FROM public NON li copre. Revochiamo
-- esplicitamente così che solo service_role possa incrementare uses_count
-- (altrimenti un utente potrebbe esaurire un coupon chiamando l'RPC).
REVOKE ALL ON FUNCTION public.increment_coupon_usage(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.increment_coupon_usage(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_coupon_usage(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_coupon_usage(text) TO service_role;

-- =============================================================================
-- 2. Rimuovi le policy di INSERT lato client su ordini e tabelle collegate
-- =============================================================================
-- Gli ordini ora si creano esclusivamente server-side (service_role bypassa la
-- RLS). Senza policy di INSERT per `authenticated`, un client autenticato non
-- può più inserire righe arbitrarie in queste tabelle. Le policy di SELECT/
-- UPDATE restano invariate (lettura ordini propri, gestione seller/rider/admin).

DROP POLICY IF EXISTS "Users can create orders" ON public.orders;
DROP POLICY IF EXISTS "Users can insert their own order_items" ON public.order_items;
DROP POLICY IF EXISTS "business_orders_buyer_write" ON public.business_orders;
