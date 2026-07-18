-- ============================================================================
-- Migration 110: Fix #38 — public profile read espone dati sensibili
-- ============================================================================
-- La policy "Public profile read" (033) era row-level, non column-level:
-- con public_profile_enabled=true tutta la riga diventava leggibile, inclusi
-- IBAN, codice fiscale, stripe_account_id, KYC.
-- Fix: rimuoviamo la policy permissiva e serviamo i campi pubblici sicuri
-- tramite una VIEW dedicata, come già fatto per i seller profile in 107.
-- ============================================================================

BEGIN;

-- Rimuove la policy permissiva su profiles
DROP POLICY IF EXISTS "Public profile read" ON public.profiles;

-- Vista pubblica: solo i campi sicuri che un compratore può voler vedere
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT
    id,
    full_name,
    avatar_url,
    -- Campi pubblici opzionali (impostati dall'utente)
    public_profile_enabled,
    -- Seller public fields
    store_name,
    store_logo,
    store_banner,
    store_description,
    store_city,
    store_address,
    is_approved,
    rating,
    total_reviews,
    delivery_time_minutes,
    min_order_amount,
    free_delivery_threshold,
    offers_express,
    -- Role (senza dati fiscali/KYC)
    role
  FROM public.profiles
  WHERE public_profile_enabled = true OR role = 'seller';

-- Permessi: anon e authenticated possono leggere la vista, NON la tabella base
GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- La policy sulla tabella base: solo il proprio profilo (+ staff)
-- (le altre policy esistenti per seller/buyer/rider/admin restano invariate)
DROP POLICY IF EXISTS "Anyone can view approved seller profiles" ON public.profiles;

COMMIT;
