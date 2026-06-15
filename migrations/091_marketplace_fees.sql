-- 091_marketplace_fees.sql
--
-- Struttura commissioni marketplace — nuove fonti di ricavo:
--   1. Commissione 10% sulle vendite (gestita in codice: MARKETPLACE_FEE_BPS).
--   2. Fee di consegna €3 trattenuta dalla piattaforma su ogni ordine con
--      consegna a domicilio → nuova colonna orders.delivery_fee_cents.
--   3. Abbonamento venditore €50/mese (Stripe subscription) attivato dopo
--      l'approvazione admin → colonne Stripe Customer/Subscription su profiles.
--      (subscription_status / subscription_renews_at esistono già da 021.)
--
-- Idempotente: tutte le colonne con IF NOT EXISTS.

-- --- 2. Fee di consegna piattaforma (in centesimi), trattenuta da MyCity.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_fee_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.delivery_fee_cents IS
  'Fee di consegna trattenuta dalla piattaforma (centesimi). Non inclusa nel payout del venditore.';

-- --- 3. Abbonamento venditore: riferimenti Stripe Customer/Subscription.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

COMMENT ON COLUMN public.profiles.stripe_customer_id IS
  'Stripe Customer del venditore (lato billing abbonamento, distinto da stripe_account_id Connect).';
COMMENT ON COLUMN public.profiles.stripe_subscription_id IS
  'Stripe Subscription attiva per l''abbonamento mensile del venditore.';
