-- 991 — Fattorino: mezzo e scadenze dopo l'approvazione
--
-- Un fattorino approvato (role = 'rider', is_approved) che dal proprio profilo
--   · passa a un mezzo a motore diverso da quello attuale (SCOOTER, CAR), o
--   · con un mezzo a motore cambia la scadenza di patente o polizza,
-- torna nella coda dello staff, con la stessa coppia di valori della
-- riattivazione in /api/admin/users/[id]/moderate (is_approved = false,
-- approval_status = 'pending') e approval_requested_at = now() (la data che la
-- lista «In attesa» mostra come «Inviata il»). Lo staff lo rivede con «approve»
-- e le regole del mezzo (lib/admin/regole-approvazione.ts).
-- Da sospeso (approval_status = 'suspended') lo stesso cambio esce con 42501:
-- la riattivazione (motivoPerNonApprovare, 'reactivate') ritrova il mezzo e le
-- scadenze dell'ultima approvazione.
-- Iscrizione, bici, targa e gli altri campi non cambiano.
--
-- Non si applica a: is_admin(), ruolo JWT service_role,
-- mycity.allow_profile_write = '1' (come enforce_profile_update_rules) e
-- ruoli diversi da anon / authenticated.
-- Il trigger gira dopo trg_enforce_profile_update_rules (ordine dei nomi).
--
-- Prova: tests/sql/rls/riparazione-s01-03.test.sql

CREATE OR REPLACE FUNCTION public.profiles_cambio_mezzo_fattorino()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    IF OLD.approval_status = 'suspended' THEN
      RAISE EXCEPTION 'profiles: mezzo e scadenze si cambiano dopo la riattivazione' USING ERRCODE = '42501';
    END IF;
    NEW.is_approved           := false;
    NEW.approval_status       := 'pending';
    NEW.approval_requested_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.profiles_cambio_mezzo_fattorino() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_cambio_mezzo_fattorino ON public.profiles;
CREATE TRIGGER trg_profiles_cambio_mezzo_fattorino
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_cambio_mezzo_fattorino();
