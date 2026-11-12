-- =============================================================================
-- 270 — Patente o polizza scadute: il fattorino non prende nuove consegne (R03-018)
-- =============================================================================
-- L'iscrizione chiede patente e polizza RC con la data di scadenza, ma dopo
-- l'approvazione nessuno le leggeva: la presa di un ordine guardava solo
-- is_rider_approvato() (ruolo e is_approved). Un fattorino approvato a settembre
-- con la polizza scaduta il 31 ottobre il 5 novembre prendeva ordini come prima.
--
-- Qui una funzione nuova, is_rider_in_regola(): approvato E documenti in regola
-- per il mezzo dichiarato, al giorno di Piacenza.
--   · una scadenza passata ferma;
--   · scooter e auto senza le due date fermano (un fattorino approvato in bici
--     che si cambia il mezzo in «auto» dal browser non consegna senza patente);
--   · in bici le date vuote non fermano: la RC della bici arriva dopo il lancio
--     per scelta di Nicola (registro dei fatti, rischi.scelti-al-lancio).
-- La usa prendi_ordine (la sola strada con cui un fattorino prende un ordine,
-- migrazione 123): con i documenti fuori regola risponde DOCUMENTI_SCADUTI.
--
-- PERCHE' NON SI CAMBIA is_rider_approvato(): la richiamano anche le regole che
-- fanno avanzare un ordine GIA' preso (ritirato → in consegna → consegnato). Se
-- la polizza scade a metà consegna, il fattorino deve poter finire quella
-- consegna, non restare con la spesa in mano. E non si vieta al fattorino di
-- riscriversi le date dal modulo: oggi nessuna rotta del server le aggiorna
-- con un documento nuovo, e il divieto avrebbe reso impossibile il rinnovo.
--
-- Prova: tests/sql/rls/riparazione-r03-scadenze-del-fattorino.test.sql
-- Per tornare indietro: rieseguire prendi_ordine della 123 e
-- DROP FUNCTION public.is_rider_in_regola().
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_rider_in_regola()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = (SELECT auth.uid()) AND p.role = 'rider' AND p.is_approved
       AND (p.rider_license_expires_on IS NULL
            OR p.rider_license_expires_on >= (now() AT TIME ZONE 'Europe/Rome')::date)
       AND (p.rider_insurance_expires_on IS NULL
            OR p.rider_insurance_expires_on >= (now() AT TIME ZONE 'Europe/Rome')::date)
       AND (coalesce(p.rider_vehicle_type, '') NOT IN ('SCOOTER', 'CAR')
            OR (p.rider_license_expires_on IS NOT NULL AND p.rider_insurance_expires_on IS NOT NULL))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_rider_in_regola() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.is_rider_in_regola() TO authenticated, service_role;

COMMENT ON FUNCTION public.is_rider_in_regola() IS
  'Fattorino approvato con patente e polizza in regola per il suo mezzo (270). La usa prendi_ordine; is_rider_approvato resta per le consegne già in corso.';

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
    RETURN jsonb_build_object('ok', false, 'motivo', 'GIA_PRESO');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_preso);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prendi_ordine(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.prendi_ordine(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
