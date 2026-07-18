-- Migrazione 111: disaccoppia il compenso rider dal prezzo di spedizione cliente.
-- rider_fee_cents = quota netta spettante al rider per la consegna.
-- Separato da shipping_cost (prezzo pagato dal buyer, che può includere sconti
-- o zero per soglie di spedizione gratuita): i due valori devono essere
-- impostati indipendentemente alla creazione ordine.
-- Gli ordini storici restano NULL → releaseRiderPayout usa il fallback a
-- shipping_cost per retrocompatibilità.
BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_fee_cents INTEGER;
COMMENT ON COLUMN orders.rider_fee_cents IS
  'Compenso di consegna netto spettante al rider (centesimi). NULL negli ordini precedenti alla migrazione 111: il payout usa shipping_cost come fallback.';
COMMIT;
