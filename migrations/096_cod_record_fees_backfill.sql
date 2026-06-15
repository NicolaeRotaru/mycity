-- 096_cod_record_fees_backfill.sql
--
-- 🔴-1 settlement COD — SLICE 1 (fondamenta): registra commissione + netto
-- venditore sugli ordini COD STORICI.
--
-- Contesto: gli ordini COD non avevano application_fee_cents né
-- seller_payout_cents → la piattaforma non registrava la commissione 10% e il
-- venditore non aveva un importo da incassare. Il codice (app/api/orders/cod) ora
-- li salva sui NUOVI ordini; qui li backfilliamo su quelli esistenti.
--
-- SOLO dati (nessun cambio di schema/CHECK) → safe da applicare in qualsiasi
-- momento, nessun rischio di ordinamento col deploy. Nessun pagamento parte da
-- qui: il payout COD (gated sulla rimessa del rider) arriva in una slice
-- successiva, qui registriamo solo gli importi.
--
-- Lordo = total_price + wallet_applied_cents (il wallet è credito piattaforma che
-- riduce il CONTANTE incassato, non il valore di vendita su cui si calcolano
-- commissione e netto). Invariante: sellerPayout + commissione + fee_consegna +
-- spedizione = lordo.
--
-- Idempotente: ricalcola da campi immutabili, solo dove non ancora valorizzato.

UPDATE public.orders o
SET
  application_fee_cents = round((round(o.total_price * 100) + COALESCE(o.wallet_applied_cents, 0)) * 0.10)::int,
  seller_payout_cents = GREATEST(0,
        (round(o.total_price * 100) + COALESCE(o.wallet_applied_cents, 0))
        - round((round(o.total_price * 100) + COALESCE(o.wallet_applied_cents, 0)) * 0.10)
        - COALESCE(o.delivery_fee_cents, 0)
        - round(COALESCE(o.shipping_cost, 0) * 100))::int
WHERE o.payment_method = 'cod'
  AND COALESCE(o.application_fee_cents, 0) = 0
  AND COALESCE(o.seller_payout_cents, 0) = 0;

NOTIFY pgrst, 'reload schema';
