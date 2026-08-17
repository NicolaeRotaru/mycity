-- 108: Espone i flag Stripe pubblici sulla vetrina (per gate badge «Verificato»)
-- Solo booleani di stato pagamento — niente stripe_account_id né IBAN.
-- Idempotente.

BEGIN;

CREATE OR REPLACE VIEW public.seller_public_profiles AS
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
  stripe_charges_enabled,
  stripe_payouts_enabled,
  role,
  created_at
FROM public.profiles
WHERE is_approved = true
  AND store_name IS NOT NULL
  AND role = 'seller';

COMMENT ON VIEW public.seller_public_profiles IS
  'Vetrina pubblica negozi approvati (colonne non sensibili + flag Stripe per badge Verificato). @foreignKey (id) references public.profiles (id)';

GRANT SELECT ON public.seller_public_profiles TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
