-- 078_fix_payout_status_processing.sql
--
-- FIX CRITICO (blocco payout venditori).
-- lib/stripe/payout.ts esegue come claim atomico:
--   UPDATE orders SET payout_status='PROCESSING' ...
-- ma 'PROCESSING' NON era ammesso dal CHECK orders_payout_status_check
-- (definito in 042, esteso in 043). Ogni UPDATE veniva quindi rigettato dal
-- vincolo → nessun payout seller via carta partiva mai, e il fallimento era
-- silenzioso (l'errore veniva ignorato a valle, vedi fix in payout.ts).
--
-- Inoltre rider_payout_status (aggiunto in 046) era privo di CHECK: introduciamo
-- un vincolo simmetrico con gli stati realmente usati dal codice
-- (NULL | HELD | PROCESSING | PENDING_RIDER_ONBOARDING | TRANSFERRED | FAILED).
--
-- Idempotente: drop-if-exists + recreate.

-- Seller payout: aggiunge 'PROCESSING' all'enum esistente.
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
        'REVERSED'
    ));

-- Rider payout: introduce il CHECK (prima assente). NULL resta ammesso.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_rider_payout_status_check') THEN
        ALTER TABLE public.orders DROP CONSTRAINT orders_rider_payout_status_check;
    END IF;
END$$;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_rider_payout_status_check
    CHECK (rider_payout_status IS NULL OR rider_payout_status IN (
        'HELD',
        'PROCESSING',
        'PENDING_RIDER_ONBOARDING',
        'TRANSFERRED',
        'FAILED'
    ));

NOTIFY pgrst, 'reload schema';
