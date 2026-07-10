-- 109: Blocca auto-assegnazione role='rider' da parte dell'utente
--       e restinge la RLS ordini ai soli rider approvati.
--
-- La migrazione 061 blocca solo NEW.role='admin'; un utente poteva
-- auto-assegnarsi role='rider', poi "claimare" un ordine READY/ACCEPTED
-- (il ramo rider_id IS NULL della policy 019 non controllava role né is_approved).
--
-- Fix:
--   1) Aggiornamento trigger enforce_profile_update_rules: aggiunge blocco su role='rider'
--   2) Nuova RLS su orders: il ramo "disponibile per rider" richiede role='rider' E is_approved=true
--
-- Idempotente.

-- =========================================================
-- 1) Trigger: blocca anche auto-promozione a 'rider'
-- =========================================================
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_profile_write', true), '') = '1';
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  -- Vietato auto-promuoversi admin o rider (cambi di ruolo riservati allo staff)
  IF NEW.role IN ('admin', 'rider') AND OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'profiles: cambio ruolo riservato allo staff' USING ERRCODE = '42501';
  END IF;

  -- Vietato auto-approvarsi (false/null -> true)
  IF NEW.is_approved = true AND OLD.is_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profiles: approvazione riservata allo staff' USING ERRCODE = '42501';
  END IF;

  -- approval_status: l'utente può solo richiedere ('pending'); approvazioni/rifiuti/sospensioni allo staff
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND coalesce(NEW.approval_status, '') NOT IN ('pending', '') THEN
    RAISE EXCEPTION 'profiles: stato approvazione riservato allo staff' USING ERRCODE = '42501';
  END IF;

  -- Campi gestiti SOLO da staff/server (audit approvazione + Stripe Connect + KYC + subscription)
  IF NEW.approved_by              IS DISTINCT FROM OLD.approved_by
  OR NEW.approved_at              IS DISTINCT FROM OLD.approved_at
  OR NEW.stripe_account_id        IS DISTINCT FROM OLD.stripe_account_id
  OR NEW.stripe_charges_enabled   IS DISTINCT FROM OLD.stripe_charges_enabled
  OR NEW.stripe_payouts_enabled   IS DISTINCT FROM OLD.stripe_payouts_enabled
  OR NEW.stripe_details_submitted IS DISTINCT FROM OLD.stripe_details_submitted
  OR NEW.kyc_provider_status      IS DISTINCT FROM OLD.kyc_provider_status
  OR NEW.kyc_provider_check_id    IS DISTINCT FROM OLD.kyc_provider_check_id
  OR NEW.kyc_provider_checked_at  IS DISTINCT FROM OLD.kyc_provider_checked_at
  OR NEW.subscription_status      IS DISTINCT FROM OLD.subscription_status
  THEN
    RAISE EXCEPTION 'profiles: campo riservato non modificabile' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- =========================================================
-- 2) RLS ordini: solo rider approvati vedono la coda disponibile
-- =========================================================
DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;
CREATE POLICY "Riders can view available and own orders"
  ON public.orders FOR SELECT TO authenticated
  USING (
    -- I propri ordini (rider già assegnato)
    rider_id = auth.uid()
    OR
    -- Ordini disponibili: solo rider con is_approved=true
    (
      delivery_status IN ('ACCEPTED', 'READY')
      AND rider_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'rider'
          AND is_approved = true
      )
    )
  );

NOTIFY pgrst, 'reload schema';
