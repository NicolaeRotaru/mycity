-- =============================================================================
-- 116 — Soldi: quello che si perdeva per strada
-- =============================================================================
-- Due pezzi di database che servono alle correzioni sui pagamenti:
--
--   1. `seller_payout_cents` veniva usato come contatore: alla creazione
--      dell'ordine conteneva il netto del venditore, ma ogni storno lo
--      DECREMENTAVA. Da quel momento tutti i conti costruiti su quel campo
--      erano sbagliati — i guadagni mostrati al negoziante, i rendiconti
--      dell'amministrazione, e soprattutto il calcolo della quota da recuperare
--      al rimborso successivo, che si basa proprio su quel numero. Ora il netto
--      resta fermo e lo stornato si accumula a parte.
--
--   2. il codice sconto veniva «consumato» prima di creare la sessione di
--      pagamento e non tornava MAI indietro: pagamento non concluso, carrello
--      abbandonato o sessione scaduta lasciavano un uso in meno per sempre. Non
--      esisteva nessuna funzione per restituirlo.
--
-- Prova: tests/unit/soldi-storni-e-coupon.test.ts
-- Idempotente.
-- =============================================================================

BEGIN;

-- =========================================================
-- 1) Quanto e' stato stornato, tenuto a parte dal netto
-- =========================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS seller_payout_reversed_cents int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.seller_payout_cents IS
  'Netto del venditore al momento dell''ordine. NON si modifica mai: gli storni si accumulano in seller_payout_reversed_cents.';
COMMENT ON COLUMN public.orders.seller_payout_reversed_cents IS
  'Totale recuperato dal venditore con storni (rimborsi, contestazioni). Il residuo ancora recuperabile e'' seller_payout_cents - questo.';

-- Ricostruzione per le righe già stornate: se il payout risulta stornato del
-- tutto, il recuperato e' l'intero netto rimasto scritto.
UPDATE public.orders
   SET seller_payout_reversed_cents = coalesce(seller_payout_cents, 0)
 WHERE payout_status = 'REVERSED'
   AND seller_payout_reversed_cents = 0;

-- =========================================================
-- 2) Restituire un codice sconto non consumato
-- =========================================================
CREATE OR REPLACE FUNCTION public.release_coupon(p_code text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nuovo int;
BEGIN
  IF p_code IS NULL OR trim(p_code) = '' THEN
    RETURN 0;
  END IF;

  -- Mai sotto zero: se due percorsi di annullamento restituiscono lo stesso
  -- codice, il contatore non va in negativo.
  UPDATE public.coupons
     SET uses_count = greatest(0, uses_count - 1)
   WHERE code = upper(trim(p_code))
  RETURNING uses_count INTO nuovo;

  RETURN coalesce(nuovo, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_coupon(text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_coupon(text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
