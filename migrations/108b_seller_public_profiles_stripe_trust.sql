-- 108b: Espone i flag Stripe pubblici sulla vetrina (per gate badge «Verificato»)
-- Solo booleani di stato pagamento — niente stripe_account_id né IBAN.
--
-- ⚠️ DROP + CREATE, non CREATE OR REPLACE. Le due colonne nuove vanno inserite
-- PRIMA di role/created_at per tenere l'ordine logico, ma CREATE OR REPLACE VIEW
-- consente solo di AGGIUNGERE colonne in coda. Con la vista gia' esistente
-- fallisce con:
--   ERROR 42P16: cannot change name of view column "role" to "stripe_charges_enabled"
-- Era questo il motivo per cui la migration non risultava applicata in produzione
-- (verificato il 17/08/2026: supabase_migrations.schema_migrations non la
-- conteneva, e la vista non aveva le due colonne).
--
-- Sicuro: nessun altro oggetto dipende dalla vista (pg_depend vuoto).
-- Il DROP azzera i permessi, quindi vanno riassegnati: SOLO SELECT — vedi
-- 113_revoke_public_writes_on_views.sql per il perche' la scrittura non va data.

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
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.seller_public_profiles FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
