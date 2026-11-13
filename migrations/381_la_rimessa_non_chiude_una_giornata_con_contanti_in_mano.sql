-- 381_la_rimessa_non_chiude_una_giornata_con_contanti_in_mano.sql
--
-- 13/11/2026 (R14-002) — UNA GIORNATA DI CASSA E' VERSATA SOLO SE NON RESTA
-- NIENTE DA VERSARE.
--
-- Il registro dei contanti (`cod_reconciliations`) ha una riga per fattorino e
-- per giorno, con un solo «versato» (`remitted_at`). La conferma della rimessa
-- (`confirm_cod_remittance`, migrazione 127) lo scriveva SEMPRE, e nessuno lo
-- toglieva piu'.
--
-- Cosa succedeva davvero. Martedi' pomeriggio l'amministratore conferma la
-- rimessa dell'ordine A: A passa a HELD e la giornata prende «versata». La sera
-- lo stesso fattorino incassa e consegna B, 20,50 euro, nello stesso giorno: B
-- aspetta la rimessa, ma la riga resta «versata» all'ora del pomeriggio, anche
-- dopo il ricalcolo della quadratura e quello notturno (che non toccano mai
-- `remitted_at`). Lo stesso con un ordine consegnato senza incasso: la conferma
-- lo salta («saltati_senza_incasso: 1») e scrive comunque «versato».
--
-- Il negozio veniva pagato lo stesso (la pagina delle rimesse legge gli
-- ordini). Il danno era sulla cancellazione dell'account: la guardia
-- (`contantiAncoraDaVersare`, lib/account/cancellazione.ts) e il sorvegliante
-- delle cancellazioni in attesa (lib/privacy/cancellazioni-in-sospeso.ts)
-- leggono proprio `remitted_at`. Un fattorino con i contanti in tasca poteva
-- farsi cancellare, e con l'account se ne andavano la riga del registro e le
-- prove per recuperarli.
--
-- LA REGOLA, UNA SOLA: una giornata e' versata solo se non restano ordini in
-- contanti del fattorino, consegnati quel giorno (giorno di Piacenza, come la
-- conferma, la quadratura e la pagina delle rimesse), ancora da versare
-- (`AWAITING_REMITTANCE`). La tengono in piedi tre pezzi:
--
--   ① la conferma scrive «versato» solo in quel caso; altrimenti lascia la
--     giornata aperta (`remitted_at` e `remitted_by` vuoti);
--   ② un grilletto sugli ordini riapre una giornata gia' versata quando ci
--     arriva un ordine in contanti consegnato e da versare (il caso di B);
--   ③ una sola volta, qui sotto, si riaprono le giornate che oggi risultano
--     versate con ordini ancora da versare: la stessa regola sui dati che ci
--     sono gia'.
--
-- La giornata riaperta compare di nuovo nella pagina delle rimesse (che legge
-- gli ordini da versare), l'amministratore la conferma e si richiude: nessuna
-- giornata resta aperta per sempre.
--
-- PERCHE' IL GIORNO DELLA CONSEGNA E NON QUELLO DELL'INCASSO. Un ordine in
-- strada con l'incasso dichiarato non e' ancora rimettibile (la rimessa rilascia
-- solo i consegnati) e il suo giorno di cassa e' quello in cui verra' chiuso:
-- un incasso delle 23:58 consegnato alle 00:02 sta nel giorno dopo. Contarlo nel
-- giorno dell'incasso lascerebbe aperta per sempre una giornata in cui non
-- resta piu' niente da versare, e che la pagina non mostra piu'. Lo conta il
-- grilletto ② quando viene consegnato.
--
-- LA CORSA CON LA CONSEGNA. La conferma e il grilletto si mettono in fila sulla
-- stessa chiave (fattorino, giorno) con un lucchetto di transazione: se il
-- fattorino chiude B mentre l'amministratore conferma, o la conferma vede B
-- (e lo rilascia, o lascia la giornata aperta) o il grilletto vede «versato»
-- (e lo toglie). Il grilletto prende il lucchetto solo quando l'ordine DIVENTA
-- da versare in quel giorno, cosi' non si mette in fila per niente.
--
-- La firma, SECURITY DEFINER, il search_path e i permessi della conferma
-- restano quelli della 127: CREATE OR REPLACE conserva proprietario e permessi
-- gia' concessi o revocati. La risposta resta la stessa
-- ({rilasciati, saltati_senza_incasso}). Si puo' rieseguire.
-- Non si applica da sola: la applica Nicola.

-- ① La conferma della rimessa ------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_cod_remittance(p_rider uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_released integer; v_saltati integer; v_restano integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- 381 — In fila con il grilletto che riapre la giornata (② qui sotto): la
  -- stessa chiave, fino alla fine della transazione.
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

  -- 381 — Quello che resta da versare DOPO il rilascio, contato adesso: e' la
  -- domanda a cui risponde «versato».
  SELECT count(*) INTO v_restano
    FROM public.orders
   WHERE rider_id = p_rider
     AND payment_method = 'cod'
     AND delivery_status = 'DELIVERED'
     AND payout_status = 'AWAITING_REMITTANCE'
     AND (delivered_at AT TIME ZONE 'Europe/Rome')::date = p_date;

  IF v_restano = 0 THEN
    INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
    VALUES (p_rider, p_date, now(), (SELECT auth.uid()))
    ON CONFLICT (rider_id, for_date)
    DO UPDATE SET remitted_at = now(), remitted_by = (SELECT auth.uid());
  ELSE
    -- Resta contante da versare (o da chiarire): la giornata e' aperta, anche
    -- se prima risultava versata.
    INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
    VALUES (p_rider, p_date, NULL, NULL)
    ON CONFLICT (rider_id, for_date)
    DO UPDATE SET remitted_at = NULL, remitted_by = NULL;
  END IF;

  RETURN jsonb_build_object('rilasciati', v_released, 'saltati_senza_incasso', v_saltati);
END;
$function$;

COMMENT ON FUNCTION public.confirm_cod_remittance(uuid, date) IS
  'Rimessa contanti di un fattorino per un giorno (di Piacenza): rilascia a HELD '
  'i consegnati in contanti con l incasso dichiarato. Scrive remitted_at solo se '
  'non resta nessun ordine di quel giorno da versare; altrimenti la giornata '
  'resta aperta (381, R14-002).';

-- ② Il grilletto che riapre la giornata ---------------------------------------
CREATE OR REPLACE FUNCTION public.riapri_la_giornata_di_cassa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_giorno date;
BEGIN
  -- Solo un ordine in contanti, di un fattorino, consegnato e da versare.
  IF NEW.payment_method IS DISTINCT FROM 'cod'
     OR NEW.delivery_status IS DISTINCT FROM 'DELIVERED'
     OR NEW.payout_status IS DISTINCT FROM 'AWAITING_REMITTANCE'
     OR NEW.rider_id IS NULL
     OR NEW.delivered_at IS NULL THEN
    RETURN NULL;
  END IF;

  v_giorno := (NEW.delivered_at AT TIME ZONE 'Europe/Rome')::date;

  -- Era gia' da versare nella stessa giornata dello stesso fattorino: la
  -- giornata e' gia' aperta (la conferma non la chiude finche' c'e' lui), e
  -- non serve mettersi in fila.
  IF TG_OP = 'UPDATE'
     AND OLD.payment_method IS NOT DISTINCT FROM 'cod'
     AND OLD.delivery_status IS NOT DISTINCT FROM 'DELIVERED'
     AND OLD.payout_status IS NOT DISTINCT FROM 'AWAITING_REMITTANCE'
     AND OLD.rider_id IS NOT DISTINCT FROM NEW.rider_id
     AND OLD.delivered_at IS NOT NULL
     AND (OLD.delivered_at AT TIME ZONE 'Europe/Rome')::date = v_giorno THEN
    RETURN NULL;
  END IF;

  -- In fila con la conferma della rimessa sulla stessa giornata (①).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('cod_reconciliations|' || NEW.rider_id::text || '|' || v_giorno::text, 0));

  UPDATE public.cod_reconciliations
     SET remitted_at = NULL, remitted_by = NULL
   WHERE rider_id = NEW.rider_id
     AND for_date = v_giorno
     AND remitted_at IS NOT NULL;

  RETURN NULL;
END;
$function$;

-- Un grilletto non si chiama a mano, ma la regola del deposito vale per ogni
-- funzione SECURITY DEFINER: nessun browser la puo' eseguire.
REVOKE ALL ON FUNCTION public.riapri_la_giornata_di_cassa() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.riapri_la_giornata_di_cassa() IS
  'Riapre la giornata di cassa (cod_reconciliations.remitted_at a NULL) quando un '
  'ordine in contanti consegnato quel giorno diventa da versare dopo la rimessa '
  '(381, R14-002).';

DROP TRIGGER IF EXISTS ordini_riaprono_la_giornata_di_cassa ON public.orders;
CREATE TRIGGER ordini_riaprono_la_giornata_di_cassa
  AFTER INSERT OR UPDATE OF payment_method, delivery_status, delivered_at, payout_status, rider_id
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.riapri_la_giornata_di_cassa();

-- ③ Le giornate gia' versate con contanti ancora da versare ------------------
-- La stessa regola sui dati di oggi: si riaprono solo le giornate che hanno
-- davvero un ordine consegnato quel giorno e ancora da versare. Compaiono nella
-- pagina delle rimesse, e la conferma le richiude.
UPDATE public.cod_reconciliations c
   SET remitted_at = NULL, remitted_by = NULL
 WHERE c.remitted_at IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.orders o
      WHERE o.rider_id = c.rider_id
        AND o.payment_method = 'cod'
        AND o.delivery_status = 'DELIVERED'
        AND o.payout_status = 'AWAITING_REMITTANCE'
        AND (o.delivered_at AT TIME ZONE 'Europe/Rome')::date = c.for_date
   );

COMMENT ON COLUMN public.cod_reconciliations.remitted_at IS
  'Quando la giornata e risultata versata del tutto. NULL finche resta un ordine '
  'in contanti consegnato quel giorno e da versare: lo scrive solo '
  'confirm_cod_remittance, e lo toglie il grilletto ordini_riaprono_la_giornata_di_cassa '
  '(381, R14-002). Lo leggono la guardia della cancellazione e il sorvegliante.';

NOTIFY pgrst, 'reload schema';
