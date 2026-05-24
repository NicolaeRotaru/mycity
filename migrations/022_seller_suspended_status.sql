-- ============================================================================
-- Migration 022: stato 'suspended' distinto da 'rejected'
-- ============================================================================
-- Sospeso = era approvato, ora temporaneamente bloccato. Può essere riattivato.
-- Rifiutato = richiesta iniziale non approvata (mai operativo).
--
-- Bonus: i seller marcati "Sospeso da admin" in passato (quando confondevamo
-- i due stati) vengono migrati a 'suspended' per pulizia.
-- ============================================================================

BEGIN;

-- Allarga la CHECK
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_approval_status_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_approval_status_valid
  CHECK (approval_status IS NULL OR approval_status IN ('pending', 'approved', 'rejected', 'suspended'));

-- Backfill: chi era 'rejected' per "Sospeso da admin" → 'suspended'
UPDATE public.profiles
SET approval_status = 'suspended',
    rejection_reason = NULL
WHERE role = 'seller'
  AND approval_status = 'rejected'
  AND rejection_reason = 'Sospeso da admin';

COMMIT;
