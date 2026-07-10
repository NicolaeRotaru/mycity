-- Fix #13: reversal incrementale per rimborsi parziali multipli
-- Prima: un solo reversal per ordine (stripe_reversal_id bloccava i successivi)
-- Dopo: il campo already_reversed_cents traccia il cumulativo già stornato al venditore

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS already_reversed_cents integer NOT NULL DEFAULT 0;

-- Popola i dati esistenti: chi ha stripe_reversal_id valorizzato ha già fatto almeno un reversal
-- In assenza di dati storici, lasciamo 0 (comportamento safe: il prossimo reversal parte da 0)

COMMENT ON COLUMN orders.already_reversed_cents IS
  'Importo cumulativo già stornato al venditore via Stripe Transfer Reversal (centesimi). '
  'Usato per calcolare il delta sul prossimo reversal parziale.';
