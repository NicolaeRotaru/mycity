-- 097_cod_remittance.sql
--
-- 🔴-1 settlement COD — SLICE 2: stato AWAITING_REMITTANCE + conferma rimessa rider.
--
-- ⚠️ ORDINAMENTO DEPLOY: applicare QUESTA migrazione PRIMA del deploy del codice
-- che scrive payout_status='AWAITING_REMITTANCE' (app/api/orders/cod), altrimenti
-- l'INSERT degli ordini COD verrebbe rifiutato dal CHECK orders_payout_status_check.
--
-- Modello (scelto con l'utente): platform-centric, pagamento al venditore DOPO la
-- rimessa contanti del rider, confermata da un admin.
--   nuovo ordine COD → payout_status='AWAITING_REMITTANCE' (in attesa rimessa)
--   admin conferma rimessa rider+data → confirm_cod_remittance() → 'HELD'
--   (slice 3: cron paga il venditore gli ordini COD 'HELD').
--
-- Idempotente.

-- 1) Stato payout AWAITING_REMITTANCE (drop+recreate del CHECK, come 081).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payout_status_check') THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_payout_status_check;
  END IF;
END$$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payout_status_check
  CHECK (payout_status IN (
    'PENDING',
    'HELD',
    'PROCESSING',
    'TRANSFERRED',
    'REFUNDED',
    'FAILED',
    'PENDING_SELLER_ONBOARDING',
    'REVERSED',
    'AWAITING_REMITTANCE'
  ));

-- 2) Tracciamento rimessa sulla riconciliazione giornaliera (asse distinto dallo
--    status OK/MISMATCH, che riflette incassato vs atteso).
ALTER TABLE public.cod_reconciliations
  ADD COLUMN IF NOT EXISTS remitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS remitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3) RPC admin-only: conferma la rimessa contanti di un rider per una data e
--    rilascia gli ordini COD consegnati di quel giorno (AWAITING_REMITTANCE → HELD),
--    pronti per il payout al venditore. Ritorna il numero di ordini rilasciati.
--    La data è in giorno UTC, coerente con upsertReconciliation (cash-confirm).
--    Guard is_admin() interno: non aggirabile via PostgREST diretto.
CREATE OR REPLACE FUNCTION public.confirm_cod_remittance(p_rider uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  UPDATE public.orders
    SET payout_status = 'HELD'
  WHERE rider_id = p_rider
    AND payment_method = 'cod'
    AND delivery_status = 'DELIVERED'
    AND payout_status = 'AWAITING_REMITTANCE'
    AND (delivered_at AT TIME ZONE 'UTC')::date = p_date;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
  VALUES (p_rider, p_date, now(), auth.uid())
  ON CONFLICT (rider_id, for_date)
  DO UPDATE SET remitted_at = now(), remitted_by = auth.uid();

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_cod_remittance(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_cod_remittance(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
