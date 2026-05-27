-- =============================================================================
-- 042 — Multi-seller Stripe Checkout via pending_checkouts + transfer_group
-- =============================================================================
-- Sblocca il pagamento con carta quando il carrello include prodotti da più
-- venditori. Pattern: 1 charge sulla piattaforma -> N transfer ai seller
-- (Separate Charges and Transfers, già scelto in lib/stripe/client.ts).
--
-- Esperti consultati:
-- - Senior Payments: "SCT con N transfer post-capture; ogni transfer usa
--   source_transaction=charge_id così Stripe lega liquidità a quella charge
--   anche dopo refund o lag balance."
-- - SRE: "pending_checkouts come record-of-intent pre-webhook = resilienza
--   se webhook tarda o cade. expires_at + cron pulisce sessioni abbandonate."
-- - Tax Compliance: "Una charge buyer-facing, N ordini fiscali. Ogni seller
--   emette la propria fattura SDI sul proprio ordine."
-- - Trust & Safety: "client_reference_id Stripe = pending_checkout_id per
--   audit trail end-to-end."
-- - Risk Manager: "Nuovo stato payout PENDING_SELLER_ONBOARDING per quando
--   il seller ha venduto ma non ha ancora completato KYC Stripe Connect."
-- - Security: "Payload completo (groups, delivery, b2b) in DB, in metadata
--   Stripe solo pending_checkout_id — evita leak nome prodotti e supera il
--   limite 500 char per metadata key."

-- =============================================================================
-- TABLE: pending_checkouts (record-of-intent prima della session Stripe)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pending_checkouts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_session_id   text UNIQUE,
    stripe_payment_intent text,
    total_cents         integer NOT NULL CHECK (total_cents > 0),
    currency            text NOT NULL DEFAULT 'eur',
    groups              jsonb NOT NULL,
    coupon_code         text,
    b2b                 jsonb,
    delivery            jsonb NOT NULL,
    pickup_in_store     boolean NOT NULL DEFAULT false,
    status              text NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','COMPLETED','EXPIRED','CANCELED')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
    processed_at        timestamptz
);

COMMENT ON TABLE public.pending_checkouts IS
'Record-of-intent del buyer prima della creazione della Stripe Session. '
'Il webhook checkout.session.completed legge questa riga per creare N order '
'(uno per seller) con prezzi/sconti/spedizioni già pro-rata calcolati lato API.';

CREATE INDEX IF NOT EXISTS pending_checkouts_buyer_idx
    ON public.pending_checkouts(buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pending_checkouts_session_idx
    ON public.pending_checkouts(stripe_session_id)
    WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_checkouts_expiry_idx
    ON public.pending_checkouts(expires_at)
    WHERE status = 'PENDING';

ALTER TABLE public.pending_checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_checkouts_buyer_read ON public.pending_checkouts;
CREATE POLICY pending_checkouts_buyer_read ON public.pending_checkouts
    FOR SELECT USING (auth.uid() = buyer_id);

-- INSERT/UPDATE/DELETE: solo service_role (API server-side).
-- Nessuna policy = RLS blocca anon/authenticated automaticamente.

-- =============================================================================
-- ORDERS: transfer_group (per riconciliazione SCT) + nuovo stato payout
-- =============================================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS stripe_transfer_group text;

COMMENT ON COLUMN public.orders.stripe_transfer_group IS
'Stripe transfer_group condiviso tra tutti gli ordini della stessa charge '
'multi-seller (formato mc_<pending_checkout_id>). Usato per audit e per la '
'creazione dei transfer post-DELIVERED.';

CREATE INDEX IF NOT EXISTS orders_transfer_group_idx
    ON public.orders(stripe_transfer_group)
    WHERE stripe_transfer_group IS NOT NULL;

-- Aggiorna check constraint payout_status per il nuovo stato.
-- Drop solo se esiste, ricrea con l'enum esteso.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_payout_status_check'
    ) THEN
        ALTER TABLE public.orders DROP CONSTRAINT orders_payout_status_check;
    END IF;
END$$;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_payout_status_check
    CHECK (payout_status IN (
        'PENDING',
        'HELD',
        'TRANSFERRED',
        'REFUNDED',
        'FAILED',
        'PENDING_SELLER_ONBOARDING'
    ));

-- Idempotenza webhook: un seller non può avere due ordini per la stessa
-- Stripe session. (NULL non vincolante = OK per ordini COD.)
CREATE UNIQUE INDEX IF NOT EXISTS orders_session_seller_unique
    ON public.orders(stripe_session_id, seller_id)
    WHERE stripe_session_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
