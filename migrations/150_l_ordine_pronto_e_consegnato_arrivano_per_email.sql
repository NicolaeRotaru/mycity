-- 150_l_ordine_pronto_e_consegnato_arrivano_per_email.sql
--
-- 30/8/2026 (R007) — DUE DEI TRE MOMENTI IN CUI LA POSTA SERVE DAVVERO NON
-- ARRIVAVANO MAI.
--
-- In `lib/email/templates.ts` c'erano, scritti e impaginati, il messaggio
-- «ordine pronto» e il messaggio «ordine consegnato». Non li chiamava nessuno:
-- il cliente riceveva la conferma d'ordine e poi piu' niente.
--
-- Il motivo era strutturale, ed e' per quello che nessuno l'aveva chiuso: il
-- passaggio a «pronto» lo scrive il BROWSER del negoziante, direttamente sulla
-- tabella degli ordini, e il passaggio a «consegnato» lo scrivono due funzioni
-- dentro il database (`verify_delivery_code`, `confirm_pickup_by_seller`). Non
-- esiste nessun punto sul server dove agganciare un invio. L'unica cosa che
-- partiva era la notifica in-app della migrazione 086 — che si vede solo se
-- apri l'app.
--
-- La strada giusta e' la stessa che il database usa gia' per quelle notifiche:
-- un trigger sul cambio di stato. Qui scrive una riga in `email_queue`, con il
-- nome del template e i dati che servono a scriverlo; il giro della coda
-- (/api/cron/send-emails, ogni dieci minuti) la spedisce.
--
-- Due pezzi, in quest'ordine:
--   ① `claim_pending_emails` deve restituire anche `metadata`. Senza, il giro
--      prende la riga e non sa il numero d'ordine: il messaggio partirebbe
--      vuoto. La colonna c'e' dalla 033, la funzione non l'ha mai restituita.
--   ② il trigger che scrive la riga.
--
-- Idempotente: si puo' rieseguire.

-- =========================================================
-- ① La coda restituisce anche i dati della riga
-- =========================================================
-- Stessa funzione della 119 (claim atomico, prenotazione di 15 minuti, massimo
-- cinque tentativi): cambia solo la colonna in piu' in uscita.
DROP FUNCTION IF EXISTS public.claim_pending_emails(int);
CREATE OR REPLACE FUNCTION public.claim_pending_emails(p_max int DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, template text, attempts int, metadata jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH picked AS (
        SELECT q.id
        FROM public.email_queue q
        WHERE q.send_at <= now()
          AND q.sent_at IS NULL
          AND q.cancelled_at IS NULL
          AND q.attempts < 5
          AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '15 minutes')
        ORDER BY q.send_at
        LIMIT p_max
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.email_queue q
        SET claimed_at = now()
        FROM picked
        WHERE q.id = picked.id
        RETURNING q.id, q.user_id, q.template, q.attempts, q.metadata
    )
    SELECT c.id, c.user_id, c.template, c.attempts, c.metadata FROM claimed c;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_emails(int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_emails(int) TO service_role;

-- =========================================================
-- ② Il trigger che mette in coda le due email d'ordine
-- =========================================================
-- Best-effort, esattamente come `notify_buyer_on_order_status` della 086: una
-- email che non si riesce a mettere in coda non deve MAI far fallire il
-- passaggio di stato di un ordine. Meglio un messaggio perso che un ordine che
-- non avanza.
--
-- Sul RITIRO IN NEGOZIO il messaggio porta indirizzo e codice: e' il codice che
-- il cliente mostra al bancone e che il negoziante digita in
-- `confirm_pickup_by_seller`, cioe' `order_delivery_codes`. Su una consegna a
-- domicilio quel codice NON si manda: li' e' la chiave che il fattorino chiede
-- alla porta, e va detta al momento, non anticipata per email.
CREATE OR REPLACE FUNCTION public.enqueue_order_status_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template   text;
  v_ritiro     boolean := coalesce(NEW.pickup_in_store, false);
  v_negozio    text;
  v_indirizzo  text;
  v_codice     text;
BEGIN
  IF NEW.delivery_status IS NOT DISTINCT FROM OLD.delivery_status THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.delivery_status = 'READY' THEN
    v_template := 'order_ready';
  ELSIF NEW.delivery_status = 'DELIVERED' THEN
    v_template := 'order_delivered';
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    SELECT p.store_name, p.store_address
      INTO v_negozio, v_indirizzo
      FROM public.profiles p
     WHERE p.id = NEW.seller_id;

    IF v_template = 'order_ready' AND v_ritiro THEN
      SELECT c.code INTO v_codice
        FROM public.order_delivery_codes c
       WHERE c.order_id = NEW.id;
    END IF;

    -- Una riga sola per ordine e per momento: `send_at` a now(), quindi il
    -- prossimo giro la prende. Se lo stesso passaggio si ripete (un ordine
    -- rimesso in READY), la riga precedente e' gia' partita e questa e' una
    -- notizia nuova: non si de-duplica qui, si de-duplica sul fatto che lo
    -- stato cambia davvero (il controllo IS NOT DISTINCT FROM qui sopra).
    INSERT INTO public.email_queue (user_id, template, send_at, metadata)
    VALUES (
      NEW.user_id,
      v_template,
      now(),
      jsonb_strip_nulls(jsonb_build_object(
        'orderId',       NEW.id::text,
        'pickupInStore', v_ritiro,
        'storeName',     v_negozio,
        'storeAddress',  CASE WHEN v_ritiro THEN v_indirizzo ELSE NULL END,
        'pickupCode',    v_codice,
        'totalEuro',     round(coalesce(NEW.total_price, 0)::numeric, 2)
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort: la posta non blocca l'avanzamento di un ordine
  END;

  RETURN NEW;
END;
$$;

-- 31/8/2026 — LA PORTA CHE ERA RESTATA APERTA.
-- Poche righe sopra, `claim_pending_emails` viene tolta a PUBLIC, authenticated e
-- anon. Questa no: e' nata SECURITY DEFINER e raggiungibile da chiunque, anche da
-- chi non ha un account. E' una funzione che ACCODA EMAIL: in mano a un anonimo
-- diventa un modo per far partire posta a nostro nome.
-- Il trigger continua a funzionare: lo esegue il proprietario della tabella, non
-- chi ha fatto la UPDATE. Il controllo che lo tiene chiuso e'
-- tests/sql/rls/10-nessuna-porta-nuova-aperta-agli-anonimi.test.sql, che diventa
-- rosso il giorno stesso in cui una funzione potente nuova entra senza dichiararsi.
REVOKE EXECUTE ON FUNCTION public.enqueue_order_status_email() FROM PUBLIC, authenticated, anon;

DROP TRIGGER IF EXISTS trg_enqueue_order_status_email ON public.orders;
CREATE TRIGGER trg_enqueue_order_status_email
  AFTER UPDATE OF delivery_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_order_status_email();

COMMENT ON FUNCTION public.enqueue_order_status_email() IS
  'R007 — mette in coda «ordine pronto» e «ordine consegnato» al cambio di stato: e'' l''unico punto che vede TUTTI i passaggi, browser del negoziante e RPC del database compresi.';

NOTIFY pgrst, 'reload schema';
