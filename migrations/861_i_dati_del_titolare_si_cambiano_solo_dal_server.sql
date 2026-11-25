-- 861 — Nome, codice fiscale, nascita e residenza del titolare non si cambiano dal browser
--
-- Il difetto: la guardia dei profili (119, ultima in 709) elenca fra i campi che
-- ognuno può cambiare di sé anche le sette colonne `legal_*`: nome, cognome, data
-- di nascita, codice fiscale e residenza di chi firma. Con la regola «Users can
-- update their own profile» (001) chiunque sia collegato poteva scriverle
-- direttamente col client Supabase del browser, saltando la rotta del server.
--
-- Perché conta. Dal 25/11/2026 i dati del titolare di un negozio si scrivono con
-- PATCH /api/seller/titolare: controlla il formato e i 18 anni, e avvisa lo staff
-- quando un negozio in attesa li scrive la prima volta e quando un dato già
-- scritto cambia. E l'approvazione di un negozio li pretende
-- (lib/admin/regole-approvazione.ts, freno confermato da Nicola il 25/11). Chi li
-- scriveva dal browser cambiava chi firma senza che lo staff lo sapesse, con un
-- codice fiscale di qualunque forma accettata dal vincolo della 021. La maggiore
-- età resta protetta anche dal vincolo `profiles_maggiore_eta` (156).
--
-- L'unica pagina che le scriveva dal browser era l'iscrizione del fattorino
-- (app/rider/onboarding): da oggi passa da PATCH /api/rider/anagrafica, con gli
-- stessi controlli. È lo stesso passo che la 365 ha fatto per IBAN e dati fiscali.
--
-- La cura: le sette colonne escono dall'elenco `consentiti`. Il resto della
-- funzione è identico alla 709, riga per riga. Chi scrive con la chiave di
-- servizio (le rotte), l'admin e la scrittura autorizzata del database
-- (`mycity.allow_profile_write`) non cambiano.
--
-- Prova: tests/sql/rls/i-dati-del-titolare-si-cambiano-solo-dal-server.test.sql
-- (senza questa migrazione i controlli ①–④ sono ROSSI).
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_profile_write', true), '') = '1';
  consentiti constant text[] := ARRAY[
    'full_name','phone','address','city','zip',
    'public_avatar_url','public_bio','public_handle','public_profile_enabled',
    'email_marketing','notif_promos','notif_groups','notif_newsletter','notif_order_updates',
    'store_name','store_lat','store_lng','store_phone','store_address','store_description',
    'store_logo','store_hours','store_media','store_site','store_customization','offers_express',
    'rider_is_online','rider_zones','rider_schedule',
    'tos_accepted_at','privacy_accepted_at','data_accuracy_confirmed_at',
    'deletion_requested_at',
    'rider_vehicle_type','rider_vehicle_plate','rider_license_expires_on','rider_insurance_expires_on',
    'billing_card_last',
    'is_approved',
    'updated_at'
  ];
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - consentiti) IS DISTINCT FROM (to_jsonb(OLD) - consentiti) THEN
    RAISE EXCEPTION 'profiles: campo riservato non modificabile' USING ERRCODE = '42501';
  END IF;

  IF NEW.is_approved = true AND OLD.is_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profiles: approvazione riservata allo staff' USING ERRCODE = '42501';
  END IF;

  -- 400 — Un negozio sospeso non cambia il proprio stato: né «in attesa» né vuoto.
  IF OLD.approval_status = 'suspended'
     AND NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    RAISE EXCEPTION 'profiles: la sospensione la toglie solo lo staff' USING ERRCODE = '42501';
  END IF;

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND coalesce(NEW.approval_status, '') NOT IN ('pending', '') THEN
    RAISE EXCEPTION 'profiles: stato approvazione riservato allo staff' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
