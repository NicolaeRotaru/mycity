-- =============================================================================
-- 123 — Il fattorino vede l'ordine libero ma non riesce a prenderlo
-- =============================================================================
-- Errore introdotto dalla 122, blocco ①, e trovato solo dopo averla applicata.
--
-- La 122 ha stretto la policy di lettura su `orders` a `rider_id = auth.uid()`,
-- perche' un fattorino approvato poteva scaricare nome, telefono e indirizzo di
-- casa dei clienti di TUTTI gli ordini liberi della citta'. Quella stretta e'
-- giusta e resta.
--
-- Quello che non avevo previsto: in PostgreSQL un `UPDATE ... WHERE` applica
-- ANCHE le policy di SELECT alle colonne citate nel WHERE. La presa dell'ordine
-- (app/rider/page.tsx) e' scritta cosi':
--
--   UPDATE orders SET rider_id = me, delivery_status = 'ASSIGNED'
--    WHERE id = X AND rider_id IS NULL AND delivery_status = 'READY'
--
-- Su un ordine libero `rider_id` e' NULL, quindi `rider_id = auth.uid()` non e'
-- vero e la riga non e' visibile: l'UPDATE non trova niente e aggiorna zero
-- righe. Il fattorino vede l'ordine sulla bacheca e riceve «gia' preso da un
-- altro». Misurato su un database ricostruito dalle 123 migrazioni: bacheca 1
-- riga, presa 0 righe.
--
-- Il rimedio non e' allargare di nuovo la lettura — quella era la falla. E' fare
-- la presa da una funzione fidata, che gira coi permessi del proprietario e non
-- ha bisogno di vedere la riga da fuori. Guadagno secondario: la presa diventa
-- atomica per davvero, e la condizione «libero e pronto» sta in un posto solo.
--
-- La macchina a stati della 061 permetteva gia' questa transizione
-- (READY + rider_id NULL -> ASSIGNED + rider_id = uid): non cambia nulla li'.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.prendi_ordine(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_preso uuid;
BEGIN
  -- Solo un fattorino approvato. Stessa condizione della vista della bacheca.
  IF v_uid IS NULL OR NOT public.is_rider_approvato() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'NON_FATTORINO');
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);

  -- Atomico: chi arriva secondo trova rider_id gia' pieno e non aggiorna nulla.
  UPDATE public.orders
     SET rider_id = v_uid,
         delivery_status = 'ASSIGNED'
   WHERE id = p_order_id
     AND rider_id IS NULL
     AND delivery_status = 'READY'
  RETURNING id INTO v_preso;

  IF v_preso IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'GIA_PRESO');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_preso);
END;
$$;

COMMENT ON FUNCTION public.prendi_ordine(uuid) IS
  'Il fattorino approvato prende un ordine libero e pronto. Serve perche'' dalla 122 la riga di un ordine libero non e'' leggibile da fuori, e un UPDATE ... WHERE ha bisogno di leggerla.';

REVOKE EXECUTE ON FUNCTION public.prendi_ordine(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.prendi_ordine(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
