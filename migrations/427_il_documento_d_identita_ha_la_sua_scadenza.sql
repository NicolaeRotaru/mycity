-- Il documento d'identita' non aveva una scadenza: si potevano controllare solo patente e polizza.
--
-- IL DIFETTO (R18-022). Patente e polizza del fattorino hanno la loro data di scadenza
-- (rider_license_expires_on e rider_insurance_expires_on, migrazione 024) e il database la
-- controlla: is_rider_in_regola() (270) ferma la presa di nuove consegne con un documento scaduto.
-- Il documento d'identita' (kyc_id_doc_front_url e kyc_id_doc_back_url, 024; potati dalla 135 e
-- dalla 171) non ha nessuna colonna per la scadenza: nella scheda dello staff fronte e retro escono
-- senza data, e nessun controllo puo' accorgersi che e' scaduto.
--
-- LA CURA, nel database, come per patente e polizza.
--   ① La colonna `kyc_id_doc_expires_on date`, vuota per chi l'ha caricato finora.
--   ② is_rider_in_regola() guarda anche lei, con la stessa regola delle altre due: una scadenza
--     passata (al giorno di Piacenza) ferma la presa di nuove consegne, prendi_ordine risponde
--     DOCUMENTI_SCADUTI; una data vuota non ferma, quindi per i fattorini di oggi non cambia niente
--     finche' nessuno scrive la data. Le consegne gia' prese si finiscono (is_rider_approvato non
--     cambia, come nella 270).
-- La colonna NON entra fra quelle che il profilo si riscrive da solo (enforce_profile_update_rules):
-- il documento si carica dalla rotta del server (app/api/kyc/upload-document), ed e' li' che la
-- data deve arrivare, insieme al file; una data che il fattorino si allunga dal browser non
-- controllerebbe niente.
--
-- COSA RESTA FUORI DA QUI (file di altre sessioni): la rotta di caricamento che scrive la data, i
-- moduli che la chiedono, la scheda dello staff che la mostra (app/api/kyc/documenti-rider/[id]),
-- il messaggio del fattorino in app/rider/page.tsx, e lib/database.types.ts rigenerato.
--
-- RITORNO INDIETRO: rieseguire is_rider_in_regola() della 270, poi
-- `ALTER TABLE public.profiles DROP COLUMN kyc_id_doc_expires_on;`.
--
-- LA PROVA: tests/sql/rls/riparazione-r18-scadenza-documento.test.sql. Un fattorino in regola con
-- patente e polizza ma col documento d'identita' scaduto ieri prova a prendere un ordine.

-- ① ---------------------------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kyc_id_doc_expires_on date;

COMMENT ON COLUMN public.profiles.kyc_id_doc_expires_on IS
  'Scadenza del documento d''identita'' caricato (fronte e retro). Vuota = non dichiarata. R18-022.';

-- ② ---------------------------------------------------------------------------------------------
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
       AND (p.kyc_id_doc_expires_on IS NULL
            OR p.kyc_id_doc_expires_on >= (now() AT TIME ZONE 'Europe/Rome')::date)
       AND (coalesce(p.rider_vehicle_type, '') NOT IN ('SCOOTER', 'CAR')
            OR (p.rider_license_expires_on IS NOT NULL AND p.rider_insurance_expires_on IS NOT NULL))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_rider_in_regola() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.is_rider_in_regola() TO authenticated, service_role;

COMMENT ON FUNCTION public.is_rider_in_regola() IS
  'Fattorino approvato con documento d''identita'', patente e polizza in regola per il suo mezzo (270, R18-022). La usa prendi_ordine; is_rider_approvato resta per le consegne già in corso.';

NOTIFY pgrst, 'reload schema';
