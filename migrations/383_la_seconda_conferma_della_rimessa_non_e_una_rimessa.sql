-- 383_la_seconda_conferma_della_rimessa_non_e_una_rimessa.sql
--
-- 13/11/2026 (R14-006) — UNA GIORNATA GIA' VERSATA NON SI RIVERSA.
--
-- Il doppio clic su «Conferma i contanti ricevuti» (pagina delle rimesse) manda
-- due conferme uguali: stesso fattorino, stesso giorno. Col lucchetto della 381
-- le due conferme si mettono in fila e la seconda non rilascia piu' niente
-- (0 ordini), ma la funzione riscriveva lo stesso «versato»: `remitted_at` col
-- suo orario e `remitted_by` con chi aveva cliccato per secondo. Chi ha
-- ricevuto i contanti, e quando, diventava quello della conferma doppia.
--
-- LA REGOLA. La conferma scrive «versato» solo quando la giornata NON era gia'
-- versata, oppure quando rilascia davvero degli ordini. Una seconda conferma
-- uguale trova la giornata versata e niente da rilasciare: non tocca niente e
-- lo dice (`versata_ora = false`). La rotta
-- (app/api/admin/cod-remittance/route.ts) non scrive una seconda riga nel
-- registro delle azioni per una conferma che non ha rilasciato niente e non ha
-- chiuso la giornata.
--
-- Tutto il resto e' la 381, riga per riga: il lucchetto per fattorino+giorno,
-- il rilascio, il conto di quello che resta e la giornata lasciata aperta se
-- resta qualcosa. La risposta aggiunge solo `versata_ora` accanto a
-- {rilasciati, saltati_senza_incasso}. Firma, SECURITY DEFINER, search_path e
-- permessi restano quelli della 127 (CREATE OR REPLACE li conserva). Si puo'
-- rieseguire. Non si applica da sola: la applica Nicola.
--
-- REVERSIBILE: si ricrea la funzione col testo della 381.
--
-- LA PROVA: tests/sql/rls/riparazione-r14-doppia-rimessa.test.sql.

CREATE OR REPLACE FUNCTION public.confirm_cod_remittance(p_rider uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_released integer; v_saltati integer; v_restano integer; v_scritte integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- 381 — In fila con il grilletto che riapre la giornata e con un'altra
  -- conferma dello stesso fattorino per lo stesso giorno: la stessa chiave,
  -- fino alla fine della transazione.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('cod_reconciliations|' || p_rider::text || '|' || p_date::text, 0));

  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT count(*) INTO v_saltati
    FROM public.orders
   WHERE rider_id = p_rider
     AND payment_method = 'cod'
     AND delivery_status = 'DELIVERED'
     AND payout_status = 'AWAITING_REMITTANCE'
     AND (delivered_at AT TIME ZONE 'Europe/Rome')::date = p_date
     AND cash_confirmed_at IS NULL;

  UPDATE public.orders
    SET payout_status = 'HELD'
  WHERE rider_id = p_rider
    AND payment_method = 'cod'
    AND delivery_status = 'DELIVERED'
    AND payout_status = 'AWAITING_REMITTANCE'
    AND cash_confirmed_at IS NOT NULL
    AND (delivered_at AT TIME ZONE 'Europe/Rome')::date = p_date;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  SELECT count(*) INTO v_restano
    FROM public.orders
   WHERE rider_id = p_rider
     AND payment_method = 'cod'
     AND delivery_status = 'DELIVERED'
     AND payout_status = 'AWAITING_REMITTANCE'
     AND (delivered_at AT TIME ZONE 'Europe/Rome')::date = p_date;

  IF v_restano = 0 THEN
    -- 383 — «Versato» si scrive se la giornata non lo era ancora, o se questa
    -- conferma ha rilasciato degli ordini. Una seconda conferma uguale (giornata
    -- gia' versata, niente rilasciato) lascia chi e quando della prima.
    INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
    VALUES (p_rider, p_date, now(), (SELECT auth.uid()))
    ON CONFLICT (rider_id, for_date)
    DO UPDATE SET remitted_at = now(), remitted_by = (SELECT auth.uid())
     WHERE public.cod_reconciliations.remitted_at IS NULL OR v_released > 0;
    GET DIAGNOSTICS v_scritte = ROW_COUNT;
  ELSE
    -- Resta contante da versare (o da chiarire): la giornata e' aperta, anche
    -- se prima risultava versata.
    INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
    VALUES (p_rider, p_date, NULL, NULL)
    ON CONFLICT (rider_id, for_date)
    DO UPDATE SET remitted_at = NULL, remitted_by = NULL;
  END IF;

  RETURN jsonb_build_object(
    'rilasciati', v_released,
    'saltati_senza_incasso', v_saltati,
    'versata_ora', v_scritte > 0);
END;
$function$;

COMMENT ON FUNCTION public.confirm_cod_remittance(uuid, date) IS
  'Rimessa contanti di un fattorino per un giorno (di Piacenza): rilascia a HELD '
  'i consegnati in contanti con l incasso dichiarato. Scrive remitted_at solo se '
  'non resta nessun ordine di quel giorno da versare (381, R14-002), e non lo '
  'riscrive su una giornata gia versata se non rilascia niente: versata_ora dice '
  'se questa conferma l ha chiusa (383, R14-006).';

NOTIFY pgrst, 'reload schema';
