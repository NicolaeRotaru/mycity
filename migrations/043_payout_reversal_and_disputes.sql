-- 043 — Payout reversal (claw-back) + tracking chargeback Stripe
-- =============================================================================
-- Contesto: hardening del flusso SCT (Separate Charges & Transfers).
--  - Claw-back: quando un rimborso arriva DOPO il payout, si recupera la quota
--    netta dal venditore via transfers.createReversal. Serve tracciare il
--    reversal e un nuovo stato payout 'REVERSED'.
--  - Chargeback: gli eventi charge.dispute.* aggiornano dispute_status /
--    disputed_at sull'ordine; il cron di payout salta gli ordini con
--    dispute_status NOT NULL.
--  - Fix bug: la tabella disputes non aveva policy UPDATE → l'area admin
--    aggiornava 0 righe in silenzio (RLS). Aggiunta policy admin UPDATE.
-- =============================================================================

-- 1) orders: colonne per reversal + tracking dispute
-- NB: una ALTER per colonna (non multi-colonna) così il generatore offline
--     scripts/gen-db-types.mjs le rileva tutte.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stripe_reversal_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispute_status     text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS disputed_at        timestamptz;

COMMENT ON COLUMN public.orders.dispute_status IS
    'Stato chargeback Stripe: NULL | OPEN | WON | LOST. OPEN blocca il payout cron.';
COMMENT ON COLUMN public.orders.stripe_reversal_id IS
    'ID del transfer reversal (claw-back) emesso quando un rimborso/chargeback arriva dopo il payout.';

-- 2) Estende il CHECK di payout_status con 'REVERSED' (drop+recreate, come 042)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_payout_status_check'
    ) THEN
        ALTER TABLE public.orders DROP CONSTRAINT orders_payout_status_check;
    END IF;
END $$;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_payout_status_check
    CHECK (payout_status IN (
        'PENDING','HELD','TRANSFERRED','REFUNDED','FAILED','PENDING_SELLER_ONBOARDING','REVERSED'
    ));

-- 3) Index parziale per la query del cron di release payout
CREATE INDEX IF NOT EXISTS orders_payout_release_idx
    ON public.orders (delivered_at)
    WHERE payment_method = 'card'
      AND delivery_status = 'DELIVERED'
      AND payout_status IN ('HELD','PENDING_SELLER_ONBOARDING');

-- 4) Index parziale per filtrare gli ordini sotto dispute
CREATE INDEX IF NOT EXISTS orders_dispute_status_idx
    ON public.orders (dispute_status)
    WHERE dispute_status IS NOT NULL;

-- 5) FIX bug RLS: policy UPDATE per admin sulla tabella disputes.
--    La risoluzione passa comunque da service-role via API route, ma rendiamo
--    esplicita e corretta la policy per qualsiasi path autenticato-admin.
DROP POLICY IF EXISTS disputes_admin_update ON public.disputes;
CREATE POLICY disputes_admin_update ON public.disputes
    FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (true);
