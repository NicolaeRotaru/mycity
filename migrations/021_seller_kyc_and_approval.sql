-- ============================================================================
-- Migration 021: KYC venditori business + flusso di approvazione
-- ============================================================================
-- Aggiunge i campi necessari per identificare un venditore professionale:
-- dati anagrafici titolare, dati azienda, stato di approvazione.
--
-- IMPORTANTE: gli esistenti seller approvati (is_approved=true) restano
-- approvati senza interruzione. I nuovi seller dovranno passare per
-- l'approvazione dell'admin (pending_approval).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) DATI ANAGRAFICI TITOLARE (rappresentante legale del negozio)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS legal_first_name      TEXT,
  ADD COLUMN IF NOT EXISTS legal_last_name       TEXT,
  ADD COLUMN IF NOT EXISTS legal_fiscal_code     TEXT,  -- Codice Fiscale
  ADD COLUMN IF NOT EXISTS legal_birth_date      DATE,
  ADD COLUMN IF NOT EXISTS legal_residence_addr  TEXT,  -- via residenza
  ADD COLUMN IF NOT EXISTS legal_residence_city  TEXT,
  ADD COLUMN IF NOT EXISTS legal_residence_zip   TEXT;

-- Validazione codice fiscale italiano (lasca: 16 caratteri alfanumerici)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_fiscal_code_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_fiscal_code_format
  CHECK (legal_fiscal_code IS NULL OR legal_fiscal_code ~ '^[A-Z0-9]{11,16}$');

-- ----------------------------------------------------------------------------
-- 2) DATI AZIENDA
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_legal_name   TEXT,  -- ragione sociale
  ADD COLUMN IF NOT EXISTS business_vat_number   TEXT,  -- P.IVA
  ADD COLUMN IF NOT EXISTS business_form         TEXT,  -- ditta_individuale, srl, snc, ecc.
  ADD COLUMN IF NOT EXISTS business_address      TEXT,  -- sede legale via
  ADD COLUMN IF NOT EXISTS business_city         TEXT,
  ADD COLUMN IF NOT EXISTS business_zip          TEXT,
  ADD COLUMN IF NOT EXISTS business_pec          TEXT,  -- PEC
  ADD COLUMN IF NOT EXISTS business_sdi          TEXT;  -- Codice SDI per fatturazione

-- P.IVA italiana: 11 cifre. Permettiamo anche IVA UE (formato variabile).
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_vat_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_vat_format
  CHECK (business_vat_number IS NULL OR business_vat_number ~ '^[A-Z0-9]{8,15}$');

-- ----------------------------------------------------------------------------
-- 3) STATO APPROVAZIONE + AUDIT
-- ----------------------------------------------------------------------------
-- Nuovo campo enum testuale: 'pending', 'approved', 'rejected'.
-- is_approved resta per retro-compatibilità (true se status='approved').
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approval_status     TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by         UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS rejection_reason    TEXT;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_approval_status_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_approval_status_valid
  CHECK (approval_status IS NULL OR approval_status IN ('pending', 'approved', 'rejected'));

-- Allinea approval_status agli esistenti già approvati
UPDATE public.profiles
SET approval_status = 'approved',
    approved_at     = COALESCE(approved_at, NOW())
WHERE role = 'seller' AND is_approved = true AND approval_status IS NULL;

-- ----------------------------------------------------------------------------
-- 4) CONSENSI LEGALI (audit dei termini accettati al momento della richiesta)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tos_accepted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_accuracy_confirmed_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 5) PAGAMENTI (placeholder per Stripe — popolati in Fase 2)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS billing_iban           TEXT,  -- per ricevere payouts
  ADD COLUMN IF NOT EXISTS billing_card_last4     TEXT,  -- riferimento Stripe (mai PAN completo)
  ADD COLUMN IF NOT EXISTS subscription_status    TEXT,  -- 'active', 'past_due', 'canceled'
  ADD COLUMN IF NOT EXISTS subscription_renews_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 6) INDICE per la coda di approvazione admin
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS profiles_approval_pending_idx
  ON public.profiles (approval_status, approval_requested_at)
  WHERE approval_status = 'pending';

COMMIT;
