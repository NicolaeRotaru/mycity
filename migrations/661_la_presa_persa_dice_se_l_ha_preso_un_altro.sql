-- =============================================================================
-- 661 — La presa persa dice se l'ordine l'ha preso un altro o non è più pronto (R04-007)
-- =============================================================================
-- prendi_ordine (migrazioni 123 e 270) risponde GIA_PRESO ogni volta che l'UPDATE
-- atomico non prende la riga: anche quando nessuno l'ha presa ma l'ordine non è
-- più pronto (il negozio l'ha annullato, è tornato in preparazione) o è già del
-- fattorino stesso. La bacheca scrive allora «Ordine già preso da un altro rider»,
-- e a chi tocca un ordine annullato si dice che l'ha preso un altro.
--
-- Qui cambia solo la risposta dopo una presa non riuscita:
--   · GIA_PRESO          — l'ordine ha un fattorino, e non è chi chiama;
--   · NON_PIU_DISPONIBILE — tutto il resto (annullato, non più pronto, già suo,
--                           o un ordine che non c'è).
-- La presa resta quella di prima: stesso UPDATE atomico, stesse condizioni,
-- stessi controlli prima (NON_FATTORINO, DOCUMENTI_SCADUTI). Corpo uguale alla 270
-- fino all'UPDATE.
--
-- Prova: tests/sql/rls/riparazione-r04-presa-persa.test.sql
-- Per tornare indietro: rieseguire prendi_ordine della 270.
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

  -- 270 — e con patente e polizza in regola per il suo mezzo.
  IF NOT public.is_rider_in_regola() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'DOCUMENTI_SCADUTI');
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
    -- 661 — «Già preso» solo se l'ha preso davvero un altro fattorino.
    IF EXISTS (
      SELECT 1 FROM public.orders
       WHERE id = p_order_id
         AND rider_id IS NOT NULL
         AND rider_id <> v_uid
    ) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'GIA_PRESO');
    END IF;
    RETURN jsonb_build_object('ok', false, 'motivo', 'NON_PIU_DISPONIBILE');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_preso);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prendi_ordine(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.prendi_ordine(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
