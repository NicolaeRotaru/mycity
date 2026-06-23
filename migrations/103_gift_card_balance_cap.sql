-- 103_gift_card_balance_cap.sql
-- Audit 🟡-3: gift_cards aveva solo CHECK (balance_cents >= 0); nulla impediva
-- balance_cents > amount_cents (over-credit). Aggiunge il cap superiore.
-- Idempotente: drop+add del constraint. Sicuro sui dati esistenti perché il
-- saldo parte = amount e può solo decrescere (redeem).

ALTER TABLE public.gift_cards
  DROP CONSTRAINT IF EXISTS gift_cards_balance_within_amount;

ALTER TABLE public.gift_cards
  ADD CONSTRAINT gift_cards_balance_within_amount
  CHECK (balance_cents <= amount_cents);
