-- =============================================================================
-- 046 — Pagamento rider: tracciamento del payout del compenso di consegna
-- =============================================================================
-- Il rider riceve come compenso la quota `shipping_cost` dell'ordine. Per gli
-- ordini CARTA la piattaforma trattiene i fondi e trasferisce il compenso al
-- conto Connect del rider (come per il seller con seller_payout_cents). Servono
-- colonne per stato/idempotenza (non pagare due volte) e tracciabilità.
-- (Per gli ordini COD il rider incassa già i contanti: nessun transfer Stripe.)

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rider_payout_status text,   -- NULL | PENDING_RIDER_ONBOARDING | TRANSFERRED | FAILED
  ADD COLUMN IF NOT EXISTS rider_transfer_id text,
  ADD COLUMN IF NOT EXISTS rider_payout_at timestamptz;

-- Index parziale per il cron che rilascia i payout rider.
CREATE INDEX IF NOT EXISTS orders_rider_payout_release_idx
  ON public.orders (delivered_at)
  WHERE payment_method = 'card'
    AND delivery_status = 'DELIVERED'
    AND rider_id IS NOT NULL
    AND rider_payout_status IS DISTINCT FROM 'TRANSFERRED';
