-- 112: Sprint 1 radiografia — vetrina pubblica negozi senza leak PII/KYC/finanza
--
-- Problema: la policy "Anyone can view approved seller profiles" espone l'intera
-- riga profiles (IBAN, KYC, Stripe ID, wallet) a chiunque via PostgREST.
-- Soluzione: VIEW con sole colonne vetrina + revoca della policy permissiva.
-- Idempotente.

BEGIN;

DROP POLICY IF EXISTS "Anyone can view approved seller profiles" ON public.profiles;

-- DROP prima del CREATE: la 108b definisce la stessa vista con due colonne in
-- piu' (i flag Stripe) e `CREATE OR REPLACE VIEW` non sa togliere colonne —
-- l'intero file si interrompeva qui. La forma definitiva della vista sta nella
-- migrazione 114.
DROP VIEW IF EXISTS public.seller_public_profiles;

CREATE VIEW public.seller_public_profiles AS
SELECT
  id,
  store_name,
  store_address,
  store_lat,
  store_lng,
  store_phone,
  store_logo,
  store_hours,
  store_media,
  store_description,
  store_customization,
  store_site,
  offers_express,
  founded_year,
  is_approved,
  role,
  created_at
FROM public.profiles
WHERE is_approved = true
  AND store_name IS NOT NULL
  AND role = 'seller';

COMMENT ON VIEW public.seller_public_profiles IS
  'Vetrina pubblica negozi approvati (solo colonne non sensibili). @foreignKey (id) references public.profiles (id)';

GRANT SELECT ON public.seller_public_profiles TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
