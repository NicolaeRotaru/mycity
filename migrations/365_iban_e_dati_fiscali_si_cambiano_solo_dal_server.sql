-- 365 — L'IBAN dei bonifici e i dati fiscali del negozio non si cambiano dal browser
--
-- Il difetto: la guardia dei profili (migrazione 119) elenca fra i campi che
-- ognuno può cambiare di sé anche `billing_iban` e i dati fiscali `business_*`.
-- Con la regola «Users can update their own profile» (001) chiunque sia
-- collegato poteva scrivere quelle colonne direttamente dal browser, saltando il
-- controllo dell'IBAN, il blocco dei negozi sospesi e l'avviso agli
-- amministratori. Il pannello del lunedì legge proprio quell'IBAN.
--
-- La cura: le stesse colonne escono dall'elenco. Le scritture vere passano già
-- dal server con la chiave di servizio (/api/seller/apply, /api/seller/partita-iva)
-- e nessuna pagina del browser le scrive. I campi `legal_*` restano: li scrive
-- l'iscrizione del fattorino dal browser.
--
-- Stessa funzione della 119, con le sole righe dei dati fiscali e dell'IBAN tolte.
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

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND coalesce(NEW.approval_status, '') NOT IN ('pending', '') THEN
    RAISE EXCEPTION 'profiles: stato approvazione riservato allo staff' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
