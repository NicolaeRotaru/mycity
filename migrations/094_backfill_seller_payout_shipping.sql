-- 094_backfill_seller_payout_shipping.sql
--
-- CORREZIONE denaro: la spedizione era inclusa nel netto del venditore E versata
-- a parte al rider → doppio pagamento della spedizione su ogni ordine carta.
--
-- Contesto: il webhook calcolava seller_payout_cents = total - commissione -
-- delivery_fee, SENZA sottrarre la spedizione (che spetta al rider, versata via
-- releaseRiderPayout). Il fix nel codice (lib/stripe/client.ts
-- computeSellerPayoutCents) corregge i nuovi ordini; questa migrazione corregge
-- gli ordini GIÀ creati ma non ancora pagati (payout in HELD /
-- PENDING_SELLER_ONBOARDING).
--
-- Ricalcola da campi immutabili (total_price, application_fee_cents,
-- delivery_fee_cents, shipping_cost) → SAFE da rieseguire (idempotente).
-- NON tocca gli ordini già TRANSFERRED/REVERSED: un eventuale sovra-pagamento
-- già liquidato richiede un clawback separato (fuori ambito).

-- NB: enforce_order_update_rules (061) congela i campi protetti dell'ordine e
-- rifiuta l'UPDATE come ruolo postgres (42501). Si usa lo stesso bypass delle RPC
-- del backend (061/063): la GUC transaction-local mycity.allow_order_write='1'.
DO $$
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);

  UPDATE public.orders
  SET seller_payout_cents = GREATEST(0,
        round(total_price * 100)::int
        - COALESCE(application_fee_cents, 0)
        - COALESCE(delivery_fee_cents, 0)
        - round(COALESCE(shipping_cost, 0) * 100)::int)
  WHERE payment_method = 'card'
    AND payout_status IN ('HELD', 'PENDING_SELLER_ONBOARDING')
    AND seller_payout_cents IS NOT NULL;
END $$;

NOTIFY pgrst, 'reload schema';
