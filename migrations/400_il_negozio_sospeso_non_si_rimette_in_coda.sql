-- 400 — Un negozio sospeso non si rimette da solo in coda per l'approvazione
--
-- Il difetto: la guardia dei profili lascia a chi non è staff portare
-- `approval_status` a 'pending' (o vuoto) partendo da QUALUNQUE stato, anche
-- 'suspended'. La pagina /sell e /api/seller/apply rifiutano già il negozio
-- sospeso, ma con la regola «Users can update their own profile» (001) bastava
-- un aggiornamento dal browser: il negozio usciva da «sospeso» ed entrava nella
-- coda delle richieste nuove (o cancellava la sospensione mettendo lo stato vuoto).
--
-- La cura: se lo stato di partenza è 'suspended', chi non è staff non lo cambia.
-- Lo staff e il server (chiave di servizio) restano come prima. Un negozio
-- rifiutato ('rejected') può ancora ripresentare la richiesta.
--
-- Stessa funzione della 365 (l'ultima che la definisce), con il solo controllo
-- sulla sospensione in più.
CREATE OR REPLACE FUNCTION public.enforce_profile_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    'deletion_requested_at','approval_requested_at','approval_status',
    'legal_first_name','legal_last_name','legal_birth_date','legal_fiscal_code',
    'legal_residence_addr','legal_residence_city','legal_residence_zip',
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
$$;

NOTIFY pgrst, 'reload schema';
