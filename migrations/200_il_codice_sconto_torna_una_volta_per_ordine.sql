-- ═══════════════════════════════════════════════════════════════════════════
-- 200 · Il codice sconto torna una volta sola per ordine
-- ═══════════════════════════════════════════════════════════════════════════
-- lib/ordini/annulla.ts e lib/stripe/webhook/rimborsi.ts chiamano
-- release_coupon(p_code, p_order_id) e i loro commenti dicono che la funzione
-- scala l'uso solo se orders.coupon_released_at e' ancora vuoto. Quella firma
-- e quella colonna non esistevano: l'unica release_coupon era quella della 116,
-- solo p_code. Ogni chiamata prendeva PGRST202 e ripiegava sulla firma vecchia,
-- che scala un uso a ogni chiamata: due strade di annullo sullo stesso ordine
-- restituivano il codice due volte.
--
-- Qui nascono la colonna e la firma con l'ordine. La marcatura dell'ordine e lo
-- scalo stanno nella stessa funzione: la seconda chiamata, da qualunque strada
-- arrivi, trova la colonna piena e non scala niente. La 116 non si tocca: la
-- firma con solo p_code resta per i chiamanti vecchi.
--
-- Da applicare a mano (Nicola), prima di riaccendere i codici sconto in cassa
-- (CODICI_SCONTO_IN_CASSA). Finche' non c'e', il codice applicativo ripiega
-- sulla firma vecchia come oggi.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_released_at timestamptz;

COMMENT ON COLUMN public.orders.coupon_released_at IS
  'Quando il codice sconto di questo ordine e'' stato restituito (release_coupon con p_order_id). Pieno = gia'' restituito: non si scala di nuovo.';

CREATE OR REPLACE FUNCTION public.release_coupon(p_code text, p_order_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  marcato uuid;
  nuovo int;
BEGIN
  IF p_code IS NULL OR trim(p_code) = '' OR p_order_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Il turno: solo la prima chiamata per questo ordine marca la riga.
  UPDATE public.orders
     SET coupon_released_at = now()
   WHERE id = p_order_id
     AND coupon_released_at IS NULL
  RETURNING id INTO marcato;

  IF marcato IS NULL THEN
    RETURN 0; -- gia' restituito (o ordine inesistente): niente da scalare
  END IF;

  UPDATE public.coupons
     SET uses_count = greatest(0, uses_count - 1)
   WHERE code = upper(trim(p_code))
  RETURNING uses_count INTO nuovo;

  RETURN coalesce(nuovo, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_coupon(text, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_coupon(text, uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
