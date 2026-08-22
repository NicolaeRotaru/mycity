-- ═══════════════════════════════════════════════════════════════════════════
-- 126 — QUANTO E' STATO RICHIAMATO INDIETRO PER LA CONTESTAZIONE, E NIENT'ALTRO
-- ═══════════════════════════════════════════════════════════════════════════
-- Dalla radiografia del 21/8/2026, difetto sulla contestazione vinta.
--
-- IL DIFETTO. Quando una contestazione si vince, gli ordini tornavano in coda
-- per il bonifico scrivendo `seller_payout_reversed_cents = 0`. Ma quel campo
-- e' un TOTALE CUMULATO: dentro ci puo' essere anche uno storno che con la
-- contestazione non c'entra niente — per esempio un reso parziale rimborsato
-- settimane prima, in cui il negozio aveva gia' restituito la sua quota.
--
-- Azzerandolo, il conto del residuo tornava al netto pieno e il giro dei
-- bonifici versava tutto. Il negozio incassava una seconda volta la parte che
-- aveva gia' reso, e la differenza la metteva MyCity. Si perdeva anche la
-- traccia di quanto era stato davvero recuperato su quell'ordine.
--
-- LA CURA. Due colonne che tengono da parte SOLO quello che e' stato richiamato
-- indietro per la contestazione. Alla chiusura si sottrae quella cifra, invece
-- di azzerare tutto.
--
-- Idempotente. Colonne nuove con valore predefinito 0: il codice vecchio non le
-- guarda, il codice nuovo regge anche prima che questa migrazione sia applicata
-- (lib/db/migrazione-124.ts, stesso ripiego).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispute_seller_reversed_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_rider_reversed_cents  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.dispute_seller_reversed_cents IS
  'Quanto e stato richiamato indietro al negozio PER LA CONTESTAZIONE aperta. Si sottrae al totale stornato quando la contestazione si vince. Zero quando non ce n e una in corso.';
COMMENT ON COLUMN public.orders.dispute_rider_reversed_cents IS
  'Come sopra, per il compenso del fattorino.';

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ② IL BONIFICO CHE RESTA FERMO A META', E CHE NESSUNO RIPESCA
-- ═══════════════════════════════════════════════════════════════════════════
-- Il giro dei bonifici prende il turno su un ordine scrivendo
-- `payout_status = 'PROCESSING'`, poi chiama Stripe. Se il processo muore in
-- mezzo — un tetto di durata della richiesta, il riavvio di un'istanza — quello
-- stato resta scritto. E i candidati del giro successivo sono solo 'HELD' e
-- 'PENDING_SELLER_ONBOARDING': quell'ordine non viene ripescato MAI PIU'.
--
-- L'unico rimedio era una scrittura a mano nel database. Per il negoziante il
-- bonifico e' lo stipendio: un pagamento fermo a tempo indeterminato, con pochi
-- negozi veri, pesa quanto decine in un marketplace grande.
--
-- LA CURA e' la stessa gia' usata sugli eventi Stripe: il turno si data. Un
-- turno vecchio si puo' riprendere, perche' la chiave di idempotenza del
-- bonifico (`payout_seller_<id>_t<n>`) rende sicuro il ritentativo — se il
-- trasferimento era davvero partito, Stripe restituisce quello e non ne crea
-- un altro.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payout_claimed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rider_payout_claimed_at timestamptz;

COMMENT ON COLUMN public.orders.payout_claimed_at IS
  'Quando il giro dei bonifici ha preso in carico questo ordine. Un turno piu vecchio di 15 minuti si puo riprendere: vuol dire che chi l aveva preso e morto per strada.';
COMMENT ON COLUMN public.orders.rider_payout_claimed_at IS
  'Come sopra, per il compenso del fattorino.';

-- L'indice che rende economica la domanda «quali turni sono rimasti appesi?».
CREATE INDEX IF NOT EXISTS orders_payout_appesi_idx
  ON public.orders (payout_claimed_at)
  WHERE payout_status = 'PROCESSING';

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ③ IL CARRELLO IN CUI L'INCASSO NON TORNA HA UNO STATO SUO
-- ═══════════════════════════════════════════════════════════════════════════
-- Quando l'importo incassato da Stripe non coincide col preventivo, il webhook
-- lanciava un errore perche' Stripe riprovasse. Ma quello scarto nasce da come
-- i due totali sono calcolati: se c'e' una volta c'e' tutte le volte, e ogni
-- ritentativo falliva identico. Il cliente restava con i soldi presi e nessun
-- ordine, gli amministratori ricevevano lo stesso avviso a ripetizione, e dopo
-- giorni di fallimenti Stripe disattiva l'indirizzo del webhook: da li' in poi
-- si fermano TUTTI i pagamenti.
--
-- Adesso e' uno stato finale, e ha un nome che si vede nei dati: si rimborsa,
-- si avvisa una volta, e il carrello resta marcato per essere guardato.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pending_checkouts
  DROP CONSTRAINT IF EXISTS pending_checkouts_status_check;

ALTER TABLE public.pending_checkouts
  ADD CONSTRAINT pending_checkouts_status_check
  CHECK (status = ANY (ARRAY['PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED', 'MISMATCH']));

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ④ IL CREDITO MYCITY TORNA INDIETRO QUANDO L'ORDINE VIENE ANNULLATO
-- ═══════════════════════════════════════════════════════════════════════════
-- Il cliente usa 15 euro di buono regalo, il negozio rifiuta l'ordine perche' ha
-- finito il pane, e i 15 euro non esistono piu': ne' merce ne' credito. Non
-- c'era nessun modo, dall'interfaccia, di riaccreditarli. E' un buono comprato
-- con soldi veri che evapora su un rifiuto che il cliente non ha nemmeno deciso.
--
-- Il confronto e' impietoso: la rotta dell'amministratore riaccredita, il giro
-- degli ordini fermi riaccredita, e persino il rimedio interno della rotta dei
-- contanti riaccredita. Solo le due strade che usano davvero le persone — il
-- cliente che annulla e il negozio che rifiuta — no.
--
-- `wallet_credit` ha una chiave (`p_ref`): con `order_canceled_<id>` un secondo
-- annullo dello stesso ordine non accredita due volte.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_seller_id uuid; v_rider_id uuid; v_buyer_id uuid; current_status text; is_owner boolean;
        v_wallet_cents int;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (user_id = auth.uid()), seller_id, rider_id, user_id, delivery_status,
         coalesce(wallet_applied_cents, 0)
  INTO is_owner, v_seller_id, v_rider_id, v_buyer_id, current_status, v_wallet_cents
  FROM public.orders WHERE id = p_order_id;
  IF v_seller_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_owner THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OWNER'); END IF;
  IF current_status NOT IN ('NEW') THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status); END IF;
  UPDATE public.orders SET delivery_status = 'CANCELED', canceled_at = now() WHERE id = p_order_id;
  PERFORM public.restore_stock_for_order(p_order_id);

  -- Il credito speso torna al cliente. La chiave rende innocuo un secondo giro.
  IF v_wallet_cents > 0 THEN
    PERFORM public.wallet_credit(v_buyer_id, v_wallet_cents, 'order_canceled', 'order_canceled_' || p_order_id::text);
  END IF;

  IF v_seller_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_seller_id, '❌ Ordine annullato dal cliente', 'Il cliente ha annullato l''ordine #' || substr(p_order_id::text, 1, 6) || ' prima della tua conferma.', '/seller/orders/' || p_order_id);
  END IF;
  IF v_rider_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, link) VALUES
      (v_rider_id, '❌ Ordine annullato', 'L''ordine #' || substr(p_order_id::text, 1, 6) || ' e'' stato annullato.', '/rider');
  END IF;
  RETURN jsonb_build_object('ok', true, 'credito_restituito_cents', v_wallet_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.seller_reject_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_buyer_id uuid; current_status text; is_seller boolean; v_wallet_cents int;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);
  SELECT (seller_id = auth.uid()), user_id, delivery_status, coalesce(wallet_applied_cents, 0)
  INTO is_seller, v_buyer_id, current_status, v_wallet_cents
  FROM public.orders WHERE id = p_order_id;
  IF v_buyer_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); END IF;
  IF NOT is_seller THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_SELLER'); END IF;
  IF current_status NOT IN ('NEW', 'ACCEPTED') THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE', 'status', current_status); END IF;
  UPDATE public.orders SET delivery_status = 'CANCELED', canceled_at = now() WHERE id = p_order_id;
  PERFORM public.restore_stock_for_order(p_order_id);

  IF v_wallet_cents > 0 THEN
    PERFORM public.wallet_credit(v_buyer_id, v_wallet_cents, 'order_canceled', 'order_canceled_' || p_order_id::text);
  END IF;

  INSERT INTO public.notifications (user_id, title, body, link) VALUES
    (v_buyer_id, '❌ Ordine rifiutato dal negozio',
     COALESCE('Motivo: ' || p_reason, 'Il negozio non puo'' completare il tuo ordine. Niente addebiti.')
       || CASE WHEN v_wallet_cents > 0
               THEN ' Il credito MyCity che avevi usato (€' || to_char(v_wallet_cents / 100.0, 'FM999990.00') || ') e'' tornato sul tuo saldo.'
               ELSE '' END,
     '/orders/' || p_order_id);
  RETURN jsonb_build_object('ok', true, 'credito_restituito_cents', v_wallet_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.seller_reject_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_reject_order(uuid, text) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ⑤ LA RIMESSA CONFERMA SOLO IL CONTANTE CHE QUALCUNO HA REGISTRATO
-- ═══════════════════════════════════════════════════════════════════════════
-- `confirm_cod_remittance` portava a HELD — cioe' rendeva pagabile il negozio —
-- TUTTI gli ordini in contanti consegnati di quel fattorino in quel giorno,
-- senza guardare se l'incasso era mai stato registrato. E un ordine puo'
-- arrivare a «consegnato» senza passare dal riquadro dell'incasso: il codice di
-- consegna scrive DELIVERED e non chiede niente sui contanti.
--
-- Risultato: il negozio veniva pagato per contante di cui non esiste traccia.
-- Con un fattorino solo si recupera a mano; appena sono due, e' il buco da cui
-- esce il contante.
--
-- Adesso serve `cash_confirmed_at`, e la funzione dice anche QUANTI ordini ha
-- saltato per quel motivo: cosi' l'amministratore li vede, invece di non
-- saperlo.
-- ═══════════════════════════════════════════════════════════════════════════

-- Il tipo di ritorno cambia (da un numero a due numeri), quindi la vecchia va
-- tolta prima: Postgres non riscrive una funzione cambiandole il ritorno.
DROP FUNCTION IF EXISTS public.confirm_cod_remittance(uuid, date);

CREATE OR REPLACE FUNCTION public.confirm_cod_remittance(p_rider uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_released integer; v_saltati integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT count(*) INTO v_saltati
    FROM public.orders
   WHERE rider_id = p_rider
     AND payment_method = 'cod'
     AND delivery_status = 'DELIVERED'
     AND payout_status = 'AWAITING_REMITTANCE'
     AND (delivered_at AT TIME ZONE 'UTC')::date = p_date
     AND cash_confirmed_at IS NULL;

  UPDATE public.orders
    SET payout_status = 'HELD'
  WHERE rider_id = p_rider
    AND payment_method = 'cod'
    AND delivery_status = 'DELIVERED'
    AND payout_status = 'AWAITING_REMITTANCE'
    AND cash_confirmed_at IS NOT NULL
    AND (delivered_at AT TIME ZONE 'UTC')::date = p_date;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
  VALUES (p_rider, p_date, now(), auth.uid())
  ON CONFLICT (rider_id, for_date)
  DO UPDATE SET remitted_at = now(), remitted_by = auth.uid();

  RETURN jsonb_build_object('rilasciati', v_released, 'saltati_senza_incasso', v_saltati);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_cod_remittance(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_cod_remittance(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ⑥ LA POSIZIONE DEL FATTORINO SI CANCELLA A CONSEGNA FATTA
-- ═══════════════════════════════════════════════════════════════════════════
-- L'informativa privacy promette, nella tabella delle conservazioni, che la
-- posizione del fattorino si cancella a fine consegna. Nel codice non la
-- cancellava nessuno: `rider_lat`, `rider_lng` e `rider_position_updated_at`
-- restavano sull'ordine per sempre.
--
-- E' un dato personale di un lavoratore — dove si trovava, a che ora, ogni
-- pochi minuti — tenuto senza limite contro una promessa scritta. Il difetto
-- non e' solo la conservazione: e' la distanza fra quello che l'informativa
-- dice e quello che il sistema fa. Quella distanza, davanti al Garante, e'
-- l'unica cosa che conta.
--
-- Qui si chiude in due mosse: le funzioni che chiudono un ordine cancellano le
-- tre colonne, e una passata sola pulisce quelli gia' chiusi.
-- ═══════════════════════════════════════════════════════════════════════════

-- La consegna arrivata a destinazione.
DO $migra$
DECLARE corpo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO corpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'verify_delivery_code';
  IF corpo IS NULL THEN
    RAISE NOTICE 'verify_delivery_code non esiste: niente da riparare';
    RETURN;
  END IF;

  corpo := replace(corpo,
    'UPDATE public.orders SET delivery_status = ''DELIVERED'', delivered_at = now() WHERE id = p_order_id;',
    'UPDATE public.orders SET delivery_status = ''DELIVERED'', delivered_at = now(),'
    || ' rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL'
    || ' WHERE id = p_order_id;');

  IF corpo NOT LIKE '%rider_position_updated_at = NULL%' THEN
    RAISE EXCEPTION 'verify_delivery_code: non ho trovato la riga della consegna da riparare — fermo qui invece di lasciarla com''era';
  END IF;

  EXECUTE corpo;
END
$migra$;

REVOKE ALL ON FUNCTION public.verify_delivery_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_delivery_code(uuid, text) TO authenticated;

-- Gli ordini gia' chiusi: una passata sola, adesso.
UPDATE public.orders
   SET rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL
 WHERE delivery_status IN ('DELIVERED', 'CANCELED')
   AND (rider_lat IS NOT NULL OR rider_lng IS NOT NULL OR rider_position_updated_at IS NOT NULL);

-- E il guardiano che tiene la promessa anche domani: qualunque strada porti un
-- ordine a «consegnato» o «annullato», la posizione sparisce con lui. Cosi' la
-- regola non dipende dal fatto che ci si ricordi di scriverla in ogni funzione
-- nuova.
CREATE OR REPLACE FUNCTION public.cancella_posizione_a_ordine_chiuso()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.delivery_status IN ('DELIVERED', 'CANCELED') THEN
    NEW.rider_lat := NULL;
    NEW.rider_lng := NULL;
    NEW.rider_position_updated_at := NULL;
  END IF;
  RETURN NEW;
END$$;

COMMENT ON FUNCTION public.cancella_posizione_a_ordine_chiuso() IS
  'La posizione del fattorino si cancella quando l ordine si chiude: e la promessa scritta nell informativa privacy.';

DROP TRIGGER IF EXISTS ordini_cancella_posizione_a_chiusura ON public.orders;
CREATE TRIGGER ordini_cancella_posizione_a_chiusura
  BEFORE UPDATE OF delivery_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.cancella_posizione_a_ordine_chiuso();

REVOKE ALL ON FUNCTION public.cancella_posizione_a_ordine_chiuso() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ⑦ CHI VENDE HA UN NOME, UNA SEDE E UNA PARTITA IVA — E SI VEDONO
-- ═══════════════════════════════════════════════════════════════════════════
-- Sulle pagine prodotto e negozio non c'era nessuna traccia di CHI sta vendendo
-- davvero: solo l'insegna. Niente ragione sociale, niente sede, niente partita
-- IVA. Per un marketplace non e' una gentilezza: e' l'obbligo di informazione
-- precontrattuale (Codice del Consumo, art. 49) e l'obbligo del prestatore di
-- servizi della societa' dell'informazione (d.lgs. 70/2003). Il cliente ha
-- diritto di sapere con chi sta stipulando il contratto.
--
-- Sono dati d'IMPRESA, non dati personali da minimizzare: una partita IVA e una
-- sede legale sono pubbliche per costruzione, stanno sulla visura camerale.
-- Vanno nella vetrina pubblica, accanto all'insegna.
--
-- Le colonne aggiunte sono quattro: ragione sociale, forma giuridica, partita
-- IVA e sede (indirizzo, citta', CAP). Restano fuori PEC e codice SDI, che
-- servono alla fatturazione e non al cliente.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.seller_public_profiles;

CREATE VIEW public.seller_public_profiles AS
SELECT
  id,
  store_name,
  store_address,
  store_lat,
  store_lng,
  store_phone,
  store_logo,
  store_hours,
  store_media,
  store_description,
  store_customization,
  store_site,
  offers_express,
  founded_year,
  is_approved,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  role,
  created_at,
  -- Chi vende, per legge. Dati d'impresa, non dati personali.
  business_legal_name,
  business_form,
  business_vat_number,
  business_address,
  business_city,
  business_zip
FROM public.profiles
WHERE is_approved = true
  AND store_name IS NOT NULL
  AND role = 'seller';

COMMENT ON VIEW public.seller_public_profiles IS
  'Vetrina pubblica negozi approvati: colonne non sensibili, i due booleani di stato pagamento che servono al bollino Verificato, e i dati identificativi d impresa che il cliente ha diritto di vedere prima di comprare. @foreignKey (id) references public.profiles (id)';

REVOKE ALL    ON public.seller_public_profiles FROM anon, authenticated;
GRANT  SELECT ON public.seller_public_profiles TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ⑧ IL CANALE PER SEGNALARE UN CONTENUTO ILLECITO (obblighi DSA)
-- ═══════════════════════════════════════════════════════════════════════════
-- Sul sito non c'era nessun modo di segnalare un contenuto illecito: nessun
-- pulsante, nessuna rotta, nessun registro. Il regolamento europeo sui servizi
-- digitali lo chiede a ogni piattaforma che ospita contenuti di terzi, e per un
-- marketplace non e' burocrazia: e' il modo in cui un titolare di marchio, o un
-- cliente che vede un prodotto pericoloso, ce lo puo' dire.
--
-- La tabella e' minima di proposito: chi segnala, che cosa, perche', in che
-- stato e con quale esito motivato. Nessun campo che non serva a rispondere.
--
-- Chi puo' scrivere: chiunque, anche senza account (una segnalazione che
-- pretende la registrazione e' una segnalazione che non arriva). Chi puo'
-- leggere: solo l'amministrazione. Chi ha fatto una segnalazione da loggato
-- puo' rileggere le sue, per sapere com'e' finita.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.segnalazioni (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          text NOT NULL CHECK (tipo IN ('prodotto', 'negozio', 'recensione', 'messaggio')),
  oggetto_id    uuid NOT NULL,
  motivo        text NOT NULL CHECK (motivo IN (
                  'contraffatto', 'illecito', 'pericoloso', 'ingannevole',
                  'proprieta_intellettuale', 'odio_o_molestie', 'altro')),
  dettaglio     text CHECK (dettaglio IS NULL OR length(dettaglio) <= 2000),
  segnalante_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email_contatto text CHECK (email_contatto IS NULL OR length(email_contatto) <= 320),
  stato         text NOT NULL DEFAULT 'ricevuta'
                  CHECK (stato IN ('ricevuta', 'in_esame', 'accolta', 'respinta')),
  esito_motivato text CHECK (esito_motivato IS NULL OR length(esito_motivato) <= 2000),
  deciso_da     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deciso_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.segnalazioni IS
  'Segnalazioni di contenuti illeciti (DSA). Ogni segnalazione ha diritto a un esito motivato.';

CREATE INDEX IF NOT EXISTS segnalazioni_da_esaminare_idx
  ON public.segnalazioni (created_at DESC) WHERE stato IN ('ricevuta', 'in_esame');
CREATE INDEX IF NOT EXISTS segnalazioni_oggetto_idx
  ON public.segnalazioni (tipo, oggetto_id);

ALTER TABLE public.segnalazioni ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chiunque puo segnalare" ON public.segnalazioni;
CREATE POLICY "chiunque puo segnalare" ON public.segnalazioni
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    -- Se dichiari un autore, quell'autore devi essere tu.
    segnalante_id IS NULL OR segnalante_id = auth.uid()
  );

DROP POLICY IF EXISTS "le mie segnalazioni le rileggo" ON public.segnalazioni;
CREATE POLICY "le mie segnalazioni le rileggo" ON public.segnalazioni
  FOR SELECT TO authenticated
  USING (segnalante_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "solo l amministrazione decide" ON public.segnalazioni;
CREATE POLICY "solo l amministrazione decide" ON public.segnalazioni
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL    ON public.segnalazioni FROM anon, authenticated;
GRANT INSERT  ON public.segnalazioni TO anon, authenticated;
GRANT SELECT, UPDATE ON public.segnalazioni TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ⑨ UN ALIMENTARE NON SI PUBBLICA SENZA ALLERGENI
-- ═══════════════════════════════════════════════════════════════════════════
-- Si poteva pubblicare e vendere un prodotto alimentare senza dichiarare gli
-- allergeni: la scheda restava vuota e nessuno lo impediva. Non e' un dettaglio
-- di completezza — il regolamento europeo 1169/2011 vuole quell'informazione
-- PRIMA dell'acquisto anche nella vendita a distanza, e per chi e' allergico e'
-- la differenza fra una spesa e un ricovero.
--
-- PERCHE' IL CONTROLLO STA QUI E NON SOLO NEL MODULO. Al catalogo si arriva da
-- almeno quattro strade: il modulo del venditore, l'assistente AI, la creazione
-- in blocco, l'importazione da un altro sito. Un controllo scritto nel modulo
-- copre una strada su quattro, e le altre tre sono proprio quelle che
-- riempiono il catalogo in fretta. Il database e' l'unico posto da cui non si
-- passa intorno.
--
-- La bozza resta libera: si blocca la PUBBLICAZIONE, cioe' il momento in cui il
-- prodotto diventa comprabile. Chi vende un alimento senza allergeni scrive
-- «Nessuno dei 14 allergeni»: e' una dichiarazione, non un campo in bianco.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.alimentare_senza_allergeni_non_si_pubblica()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_radice text;
  v_allergeni text;
BEGIN
  -- Solo i prodotti comprabili. Bozze e archiviati passano.
  IF NEW.status IS DISTINCT FROM 'available' THEN
    RETURN NEW;
  END IF;
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- La categoria di primo livello: le sottocategorie ereditano dal padre.
  WITH RECURSIVE risali AS (
    SELECT id, parent_id, slug FROM public.categories WHERE id = NEW.category_id
    UNION ALL
    SELECT c.id, c.parent_id, c.slug
      FROM public.categories c JOIN risali r ON c.id = r.parent_id
  )
  SELECT slug INTO v_radice FROM risali WHERE parent_id IS NULL LIMIT 1;

  IF v_radice IS DISTINCT FROM 'alimentari' THEN
    RETURN NEW;
  END IF;

  v_allergeni := btrim(coalesce(NEW.attributes ->> 'allergeni', ''));
  IF v_allergeni = '' THEN
    RAISE EXCEPTION 'Un prodotto alimentare non si puo pubblicare senza dichiarare gli allergeni. Se non ne contiene nessuno, scrivi «Nessuno dei 14 allergeni».'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END$$;

COMMENT ON FUNCTION public.alimentare_senza_allergeni_non_si_pubblica() IS
  'Reg. UE 1169/2011: l informazione sugli allergeni deve esserci prima dell acquisto, anche a distanza.';

DROP TRIGGER IF EXISTS prodotti_alimentari_allergeni ON public.products;
CREATE TRIGGER prodotti_alimentari_allergeni
  BEFORE INSERT OR UPDATE OF status, attributes, category_id ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.alimentare_senza_allergeni_non_si_pubblica();

REVOKE ALL ON FUNCTION public.alimentare_senza_allergeni_non_si_pubblica() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
