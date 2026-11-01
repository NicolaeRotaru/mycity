-- =============================================================================
-- 190 — Il fattorino con patente o assicurazione scaduta non prende ordini
-- =============================================================================
-- Il difetto: l'iscrizione chiede patente e polizza RC con la data di scadenza,
-- ma dopo l'approvazione nessuno rileggeva quelle date. La presa dell'ordine
-- (prendi_ordine, migrazione 123) e il guardiano degli ordini guardano solo
-- is_rider_approvato(): un fattorino con la patente scaduta da un mese
-- continuava a prendere consegne. In piu' le due date erano nella lista dei
-- campi che il fattorino puo' riscrivere da solo (migrazione 119): bastava
-- spostarle in avanti per tornare «in regola» senza che nessuno controllasse.
--
-- Cosa cambia:
--   ① prendi_ordine() risponde DOCUMENTI_SCADUTI se la patente o la polizza
--      del fattorino sono scadute (vale fino all'ultimo giorno compreso, ora di
--      Piacenza). Una data mancante NON blocca: chi e' gia' in servizio senza
--      la data registrata non si ferma all'improvviso.
--   ② un guardiano sugli ordini rifiuta OGNI assegnazione (anche da admin o da
--      una strada che non passa da prendi_ordine) a un fattorino coi documenti
--      scaduti. E' la cintura: la funzione da sola si aggira scrivendo rider_id.
--   ③ un fattorino gia' approvato non sposta piu' una scadenza «a parole»:
--      una data nuova passa solo se ha caricato un documento NUOVO dopo
--      l'ultima data registrata (una data per ogni documento caricato).
--      Cosi' chi ha la patente scaduta la rinnova da solo in «Documenti e
--      verifica» (carica la foto nuova, poi salva la data) e non resta
--      bloccato per sempre; chi vuole solo allungare la data senza documento
--      nuovo viene rifiutato. Lo staff scrive sempre. Prima dell'approvazione
--      (iscrizione) le date restano libere.
--      Ogni data ricorda a quale documento si riferisce nelle colonne
--      rider_license_expiry_doc / rider_insurance_expiry_doc, che il
--      fattorino non puo' scrivere (sono fuori dalla lista della 119).
--
-- Non si toglie is_rider_approvato(): quella decide anche la lettura degli
-- ordini GIA' suoi, e un fattorino a meta' consegna deve poterla chiudere.
--
-- Rollback (ritorno indietro):
--   DROP TRIGGER trg_presa_solo_con_documenti_validi ON public.orders;
--   DROP FUNCTION public.presa_solo_con_documenti_validi();
--   DROP TRIGGER trg_scadenze_documenti_rider ON public.profiles;
--   DROP FUNCTION public.date_documenti_rider_dello_staff();
--   ALTER TABLE public.profiles DROP COLUMN rider_license_expiry_doc,
--                               DROP COLUMN rider_insurance_expiry_doc;
--   DROP FUNCTION public.rider_documenti_scaduti(uuid);
--   e si riesegue il CREATE OR REPLACE di prendi_ordine dalla migrazione 123.
-- =============================================================================

BEGIN;

-- Una regola sola per «scaduto», usata da tutti e tre i punti.
-- Non e' concessa a nessun ruolo: la chiamano solo le funzioni fidate qui sotto
-- (che girano coi permessi del proprietario). Cosi' nessuno puo' interrogare
-- lo stato dei documenti di un altro.
CREATE OR REPLACE FUNCTION public.rider_documenti_scaduti(p_rider uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = p_rider
       AND (   rider_license_expires_on   < (now() AT TIME ZONE 'Europe/Rome')::date
            OR rider_insurance_expires_on < (now() AT TIME ZONE 'Europe/Rome')::date)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.rider_documenti_scaduti(uuid) FROM public, anon, authenticated;

-- ① La presa dell'ordine: stessa funzione della 123, piu' il controllo date.
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

  -- Patente o polizza scadute: non si guida per le consegne.
  IF public.rider_documenti_scaduti(v_uid) THEN
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

-- ② La cintura sugli ordini: nessuna assegnazione a chi ha i documenti scaduti.
CREATE OR REPLACE FUNCTION public.presa_solo_con_documenti_validi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rider_id IS NOT NULL
     AND NEW.rider_id IS DISTINCT FROM OLD.rider_id
     AND public.rider_documenti_scaduti(NEW.rider_id) THEN
    RAISE EXCEPTION 'orders: il fattorino ha la patente o l''assicurazione scaduta'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.presa_solo_con_documenti_validi() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_presa_solo_con_documenti_validi ON public.orders;
CREATE TRIGGER trg_presa_solo_con_documenti_validi
  BEFORE UPDATE OF rider_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.presa_solo_con_documenti_validi();

-- ③ Le date dei documenti, dopo l'approvazione: una data nuova per ogni
-- documento nuovo. Ogni data ricorda il documento a cui si riferisce.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rider_license_expiry_doc   text,
  ADD COLUMN IF NOT EXISTS rider_insurance_expiry_doc text;

COMMENT ON COLUMN public.profiles.rider_license_expiry_doc IS
  'Percorso del documento patente a cui si riferisce rider_license_expires_on. Lo scrive solo il trigger trg_scadenze_documenti_rider (migrazione 190).';
COMMENT ON COLUMN public.profiles.rider_insurance_expiry_doc IS
  'Percorso della polizza RC a cui si riferisce rider_insurance_expires_on. Lo scrive solo il trigger trg_scadenze_documenti_rider (migrazione 190).';

-- Le date gia' registrate valgono per il documento gia' caricato: senza questo
-- ogni fattorino approvato potrebbe spostare la sua data una volta «gratis».
SELECT set_config('mycity.allow_profile_write', '1', true);
UPDATE public.profiles
   SET rider_license_expiry_doc = rider_license_url
 WHERE rider_license_expires_on IS NOT NULL AND rider_license_url IS NOT NULL;
UPDATE public.profiles
   SET rider_insurance_expiry_doc = rider_insurance_url
 WHERE rider_insurance_expires_on IS NOT NULL AND rider_insurance_url IS NOT NULL;
SELECT set_config('mycity.allow_profile_write', '0', true);

CREATE OR REPLACE FUNCTION public.date_documenti_rider_dello_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_priv boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR coalesce(current_setting('mycity.allow_profile_write', true), '') = '1';
  libero boolean := is_priv OR OLD.is_approved IS NOT TRUE;
BEGIN
  IF NEW.rider_license_expires_on IS DISTINCT FROM OLD.rider_license_expires_on THEN
    IF NOT libero AND NEW.rider_license_url IS NOT DISTINCT FROM OLD.rider_license_expiry_doc THEN
      RAISE EXCEPTION 'profiles: per cambiare la scadenza della patente carica prima la foto della patente nuova'
        USING ERRCODE = '42501';
    END IF;
    NEW.rider_license_expiry_doc := NEW.rider_license_url;
  END IF;

  IF NEW.rider_insurance_expires_on IS DISTINCT FROM OLD.rider_insurance_expires_on THEN
    IF NOT libero AND NEW.rider_insurance_url IS NOT DISTINCT FROM OLD.rider_insurance_expiry_doc THEN
      RAISE EXCEPTION 'profiles: per cambiare la scadenza dell''assicurazione carica prima la polizza nuova'
        USING ERRCODE = '42501';
    END IF;
    NEW.rider_insurance_expiry_doc := NEW.rider_insurance_url;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.date_documenti_rider_dello_staff() FROM public, anon, authenticated;

-- Il nome comincia per «trg_s»: i trigger BEFORE scattano in ordine alfabetico,
-- quindi questo gira DOPO il guardiano dei profili (trg_enforce_profile_update_rules,
-- migrazione 119). Il guardiano rifiuta chi prova a scrivere a mano le colonne
-- *_expiry_doc; poi qui le aggiorna solo il database.
DROP TRIGGER IF EXISTS trg_date_documenti_rider_dello_staff ON public.profiles;
DROP TRIGGER IF EXISTS trg_scadenze_documenti_rider ON public.profiles;
CREATE TRIGGER trg_scadenze_documenti_rider
  BEFORE UPDATE OF rider_license_expires_on, rider_insurance_expires_on ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.date_documenti_rider_dello_staff();

COMMIT;
