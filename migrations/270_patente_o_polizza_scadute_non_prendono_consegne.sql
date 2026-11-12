-- =============================================================================
-- 270 — Patente o polizza scadute: il fattorino non prende più consegne (R03-018)
-- =============================================================================
-- L'iscrizione chiede patente e polizza RC con la data di scadenza, ma dopo
-- l'approvazione nessuno le leggeva: la presa in carico guardava solo
-- is_rider_approvato() (ruolo e is_approved). Un fattorino approvato a settembre
-- con la polizza che scade il 31 ottobre il 5 novembre prendeva ordini come prima.
-- E poteva riscrivere da solo la data (la colonna era fra quelle che una persona
-- cambia di sé) senza caricare una polizza nuova.
--
-- ① is_rider_approvato() risponde falso se patente o polizza hanno una scadenza
--    già passata (giorno di Piacenza). Una scadenza vuota non blocca: chi va in
--    bici non ha la patente, e la RC della bici arriva dopo il lancio per scelta
--    di Nicola (registro dei fatti, rischi.scelti-al-lancio).
-- ② Dopo l'approvazione le due scadenze non si cambiano più dal browser: passano
--    da un documento nuovo e da un nuovo esame (il server scrive coi permessi di
--    servizio, che il guardiano lascia passare).
--
-- Per tornare indietro: rieseguire la definizione di is_rider_approvato() della
-- migrazione 114 e quella di enforce_profile_update_rules() della 119.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_rider_approvato()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = (SELECT auth.uid()) AND role = 'rider' AND is_approved
       AND (rider_license_expires_on IS NULL
            OR rider_license_expires_on >= (now() AT TIME ZONE 'Europe/Rome')::date)
       AND (rider_insurance_expires_on IS NULL
            OR rider_insurance_expires_on >= (now() AT TIME ZONE 'Europe/Rome')::date)
  );
$$;

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
  -- Tutto quello che una persona ha il diritto di cambiare di sé: recapiti,
  -- vetrina del negozio, preferenze, disponibilità del fattorino, dati fiscali
  -- propri. Chi aggiunge una colonna nuova e vuole renderla modificabile la
  -- mette qui, di proposito — è il punto: la scelta diventa visibile.
  consentiti constant text[] := ARRAY[
    'full_name','phone','address','city','zip',
    'public_avatar_url','public_bio','public_handle','public_profile_enabled',
    'email_marketing','notif_promos','notif_groups','notif_newsletter','notif_order_updates',
    'store_name','store_lat','store_lng','store_phone','store_address','store_description',
    'store_logo','store_hours','store_media','store_site','store_customization','offers_express',
    'rider_is_online','rider_zones','rider_schedule',
    'tos_accepted_at','privacy_accepted_at','data_accuracy_confirmed_at',
    'deletion_requested_at','approval_requested_at','approval_status',
    'account_type','business_form','business_legal_name','business_vat_number',
    'business_address','business_city','business_zip',
    'legal_first_name','legal_last_name','legal_birth_date','legal_fiscal_code',
    'legal_residence_addr','legal_residence_city','legal_residence_zip',
    'rider_vehicle_type','rider_vehicle_plate','rider_license_expires_on','rider_insurance_expires_on',
    'billing_card_last','billing_iban',
    'is_approved',   -- lasciato passare qui e governato dalla regola esplicita sotto
    'updated_at'
  ];
BEGIN
  IF is_priv THEN
    RETURN NEW;
  END IF;

  -- Il cuore: se qualcosa è cambiato FUORI dalla lista, si rifiuta.
  IF (to_jsonb(NEW) - consentiti) IS DISTINCT FROM (to_jsonb(OLD) - consentiti) THEN
    RAISE EXCEPTION 'profiles: campo riservato non modificabile' USING ERRCODE = '42501';
  END IF;

  -- `is_approved` resta fuori dalla lista, ma con la stessa apertura di prima:
  -- portarlo a `true` è dello staff, portarlo a `false` (o lasciarlo) no. Senza
  -- questa riga la richiesta di diventare venditore, che scrive is_approved=false,
  -- smetterebbe di funzionare: una riparazione non deve rompere un'altra strada.
  IF NEW.is_approved = true AND OLD.is_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profiles: approvazione riservata allo staff' USING ERRCODE = '42501';
  END IF;

  -- 12/11/2026 (migrazione 270, R03-018) — Le scadenze di patente e polizza le scrive la persona
  -- finché non è approvata (il modulo d'iscrizione). Dopo l'approvazione una scadenza nuova passa
  -- da un documento nuovo e da un nuovo esame (caricamento dal server, che scrive coi permessi
  -- di servizio): prima il fattorino poteva scrivere 31/10/2027 sulla polizza scaduta e il
  -- profilo diventava verde senza nessun documento.
  IF OLD.is_approved IS TRUE
     AND (NEW.rider_license_expires_on IS DISTINCT FROM OLD.rider_license_expires_on
          OR NEW.rider_insurance_expires_on IS DISTINCT FROM OLD.rider_insurance_expires_on) THEN
    RAISE EXCEPTION 'profiles: le scadenze di patente e polizza si aggiornano con un documento nuovo' USING ERRCODE = '42501';
  END IF;

  -- approval_status è nella lista perché una persona può CHIEDERE l'esame
  -- ('pending'); approvarsi o togliersi la sospensione no.
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND coalesce(NEW.approval_status, '') NOT IN ('pending', '') THEN
    RAISE EXCEPTION 'profiles: stato approvazione riservato allo staff' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
