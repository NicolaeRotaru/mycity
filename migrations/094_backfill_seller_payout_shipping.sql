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

UPDATE public.orders
SET seller_payout_cents = GREATEST(0,
      round(total_price * 100)::int
      - COALESCE(application_fee_cents, 0)
      - COALESCE(delivery_fee_cents, 0)
      - round(COALESCE(shipping_cost, 0) * 100)::int)
WHERE payment_method = 'card'
  AND payout_status IN ('HELD', 'PENDING_SELLER_ONBOARDING')
  AND seller_payout_cents IS NOT NULL;

NOTIFY pgrst, 'reload schema';
