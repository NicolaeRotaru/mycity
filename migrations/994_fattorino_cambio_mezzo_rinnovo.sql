-- 994 — Fattorino: mezzo e scadenze, rinnovo (aggiorna la 991)
--
-- Stessa regola della 991 per chi è approvato: il cambio di mezzo a motore o
-- delle scadenze di patente e polizza lo rimette nella coda dello staff
-- (is_approved = false, approval_status = 'pending', approval_requested_at = now()).
--
-- Cambia rispetto alla 991:
--   · da sospeso lo stesso cambio non esce più con un errore: rimette in coda
--     allo stesso modo. Lo staff lo rivede con «approve» (documenti e scadenze,
--     lib/admin/regole-approvazione.ts) invece che con «reactivate»;
--   · da approvato, con una consegna già ritirata (PICKED_UP, OUT_FOR_DELIVERY)
--     il cambio aspetta la fine di quella consegna (errore P0001 con la frase
--     per il fattorino): la consegna si finisce come dice la 270;
--   · da approvato, le consegne assegnate e non ancora ritirate (ASSIGNED)
--     tornano in bacheca con rider_release_order (la strada del fattorino che
--     lascia un ordine, con l'avviso al negozio), prima di rimetterlo in coda.
--
-- Non si applica a: is_admin(), ruolo JWT service_role,
-- mycity.allow_profile_write = '1' e ruoli diversi da anon / authenticated.
--
-- Prova: tests/sql/rls/riparazione-s01-03.test.sql

CREATE OR REPLACE FUNCTION public.profiles_cambio_mezzo_fattorino()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ordine          uuid;
  v_scrittura_prima text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated')
     OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
     OR coalesce(current_setting('mycity.allow_profile_write', true), '') = '1'
     OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.role = 'rider'
     AND (OLD.is_approved IS TRUE OR OLD.approval_status = 'suspended')
     AND NEW.rider_vehicle_type IN ('SCOOTER', 'CAR')
     AND (NEW.rider_vehicle_type         IS DISTINCT FROM OLD.rider_vehicle_type
       OR NEW.rider_license_expires_on   IS DISTINCT FROM OLD.rider_license_expires_on
       OR NEW.rider_insurance_expires_on IS DISTINCT FROM OLD.rider_insurance_expires_on) THEN

    IF OLD.is_approved IS TRUE AND OLD.id = (SELECT auth.uid()) THEN
      IF EXISTS (SELECT 1 FROM public.orders
                  WHERE rider_id = OLD.id
                    AND delivery_status IN ('PICKED_UP', 'OUT_FOR_DELIVERY')) THEN
        RAISE EXCEPTION 'Finisci prima la consegna che hai ritirato: mezzo e scadenze dei documenti si cambiano a consegna chiusa.'
          USING ERRCODE = 'P0001';
      END IF;

      v_scrittura_prima := current_setting('mycity.allow_order_write', true);
      FOR v_ordine IN
        SELECT id FROM public.orders
         WHERE rider_id = OLD.id AND delivery_status = 'ASSIGNED'
      LOOP
        IF coalesce((public.rider_release_order(v_ordine) ->> 'ok')::boolean, false) IS NOT TRUE THEN
          RAISE EXCEPTION 'Finisci prima la consegna che hai ritirato: mezzo e scadenze dei documenti si cambiano a consegna chiusa.'
            USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
      PERFORM set_config('mycity.allow_order_write', coalesce(v_scrittura_prima, ''), true);
    END IF;

    NEW.is_approved           := false;
    NEW.approval_status       := 'pending';
    NEW.approval_requested_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.profiles_cambio_mezzo_fattorino() FROM PUBLIC, anon, authenticated;
