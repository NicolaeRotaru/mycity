-- Un cliente si scriveva da solo il reso «gia' ricevuto», si metteva come negozio, e si faceva
-- rimborsare l'ordine intero tenendo la merce.
--
-- IL DIFETTO (radiografia del 3/9/2026). La strada ufficiale per chiedere un reso e'
-- `/api/returns/create`: controlla che l'ordine sia consegnato, che sia dell'utente, che non siano
-- passati i quattordici giorni del recesso, e scrive la riga con stato «richiesto» e con il negozio
-- preso dall'ordine. Ma quella non era l'UNICA strada. La regola di inserimento nata con la
-- migrazione 024 diceva soltanto questo:
--
--     create policy returns_buyer_insert on public.returns
--       for insert with check (auth.uid() = buyer_id);
--
-- Cioe': «scrivi pure una riga di reso, basta che il compratore sia tu». Stato, importo del rimborso,
-- venditore e decisore restavano LIBERI. E `returns.seller_id` punta ad `auth.users`, non a un
-- negozio approvato: il cliente ci poteva mettere perfino se stesso. Con la chiave pubblica e il
-- proprio token — nessun trucco, la chiamata che fa il sito tutti i giorni — bastava inserire un reso
-- con stato «merce ricevuta», venditore = se stesso e importo = il totale dell'ordine, e poi chiamare
-- `POST /api/returns/<id>/avanza` con «rimborsato». Quella rotta riconosceva «il negozio» proprio
-- leggendo `returns.seller_id`, quindi rispondeva di si'.
--
-- Anna ordina quarantadue euro da Pane Quotidiano, consegnato il 25 luglio. Il 3 settembre — quaranta
-- giorni dopo, ben oltre il recesso — si rimborsa da sola quarantadue euro. Il fornaio non ha mai
-- visto arrivare una richiesta.
--
-- LA CAUSA, ED E' DOPPIA. (1) Nel database: una regola di scrittura che fissa una colonna sola e
-- lascia libere quelle che contano — stato, soldi, controparte. (2) Nel codice: due rotte che
-- decidevano un RUOLO leggendo un campo scritto dalla controparte. La gamba del codice e' gia'
-- riparata (`app/api/returns/chi-comanda-il-reso.ts`: il negozio si ricava dall'ordine, dal server).
-- Questa migrazione e' la gamba del database, e serve lo stesso: un permesso lasciato aperto e' un
-- buco che aspetta la prossima rotta scritta con la stessa buona fede.
--
-- COSA FA QUESTA MIGRAZIONE, in tre mosse.
--
-- ① I RESI LI APRE IL SERVER. Si toglie la regola `returns_buyer_insert` e si tolgono i permessi di
--    scrittura a chi non ha fatto l'accesso e a chi l'ha fatto. Non e' una perdita di funzione:
--    `/api/returns/create` scrive con la chiave di servizio, quindi la strada del sito resta intatta.
--    Cambia solo che l'unica strada e' quella, e quella ha i controlli dentro.
--
--    Nota per chi legge fra sei mesi: la 145 riconcede da sola INSERT/UPDATE/DELETE alle tabelle che
--    hanno una regola permissiva per quel comando, e su `returns` c'e' `returns_admin_all` che e'
--    `FOR ALL`. La 145 gira PRIMA di questa (145 < 153), quindi qui la revoca vince. Se un giorno
--    quel ciclo venisse rieseguito dopo, il permesso tornerebbe: per questo la difesa vera e' la
--    ③ qui sotto, che non dipende dai permessi.
--
-- ② UNA RIGA DI RESO DEVE DIRE LA VERITA' SULL'ORDINE. Un trigger di guardia, come quelli che gia'
--    esistono su `orders` (`enforce_order_update_rules`) e su `subscription_orders`: il compratore e
--    il venditore scritti sul reso devono essere quelli dell'ordine, e l'ordine di un reso non si
--    cambia strada facendo. Vale per CHIUNQUE scriva, chiave di servizio compresa: non e' un
--    permesso, e' un fatto. Cosi' il giorno in cui una rotta nuova sbaglia, la riga non entra.
--
--    Le colonne vuote restano ammesse: la 122 le ha rese annullabili apposta, perche' cancellando un
--    account il legame si stacca (`ON DELETE SET NULL`) e la pratica del reso deve restare, anonima.
--
-- ③ UN RESO NASCE «RICHIESTO». Nessuno apre un reso gia' ricevuto o gia' rimborsato: le tappe si
--    salgono una alla volta, e la prima e' la richiesta. E' il paletto che rende inutile l'attacco
--    anche se un domani i permessi tornassero larghi.
--
-- COSA NON TOCCA. La lettura: il cliente continua a vedere i propri resi (`returns_buyer_read`), il
-- negozio i suoi (`returns_seller_read`), l'amministratore tutto. E la chiave di servizio scrive come
-- prima, con in piu' i due paletti della ② e della ③.
--
-- SE NICOLA NON LA APPLICA: la gamba del codice da sola chiude l'attacco per intero — con il negozio
-- letto dall'ordine, il reso auto-scritto non fa piu' avanzare niente e il rimborso non parte. Resta
-- pero' aperta la porta del database: un cliente puo' ancora INSERIRE nella tabella `returns` righe
-- inventate (stato, importo e venditore a piacere). Non escono soldi, ma il pannello del negoziante
-- si riempie di pratiche false, il giro dei bonifici le vede come «reso aperto» e TIENE FERMO il
-- pagamento di quell'ordine — un cliente scontento puo' bloccare i soldi del negozio a comando. E la
-- riparazione del codice resta l'unico strato: la prossima rotta che legge `returns.seller_id`
-- riapre il buco per intero.
--
-- REVERSIBILE:
--   DROP TRIGGER IF EXISTS trg_returns_coerenti_con_l_ordine ON public.returns;
--   DROP FUNCTION IF EXISTS public.returns_coerenti_con_l_ordine();
--   CREATE POLICY returns_buyer_insert ON public.returns FOR INSERT WITH CHECK (auth.uid() = buyer_id);
--   GRANT INSERT ON public.returns TO authenticated;
-- (cioe' esattamente il difetto di prima: si torna indietro solo sapendo a cosa si torna).
--
-- LA PROVA: tests/sql/rls/28-il-reso-lo-apre-il-server-non-il-cliente.test.sql

BEGIN;

-- ── ① I resi li apre il server ────────────────────────────────────────────────
DROP POLICY IF EXISTS returns_buyer_insert ON public.returns;

REVOKE INSERT, UPDATE, DELETE ON public.returns FROM anon, authenticated;

-- ── ② e ③ Il guardiano della riga ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.returns_coerenti_con_l_ordine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller uuid;
  v_buyer  uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Un reso non cambia ordine: resta attaccato a quello per cui e nato.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Un reso nasce «richiesto»: le tappe si salgono una alla volta, dalla prima.
  IF TG_OP = 'INSERT' AND coalesce(NEW.status, 'REQUESTED') <> 'REQUESTED' THEN
    RAISE EXCEPTION 'Un reso nasce in REQUESTED, non in %: le tappe si salgono una alla volta.', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT o.seller_id, o.user_id INTO v_seller, v_buyer
    FROM public.orders o
   WHERE o.id = NEW.order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Il reso indica un ordine che non esiste.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Il confronto salta quando una delle due parti e' vuota: cancellando un
  -- account il legame si stacca (122), e la pratica deve restare scrivibile.
  IF NEW.seller_id IS NOT NULL AND v_seller IS NOT NULL AND NEW.seller_id <> v_seller THEN
    RAISE EXCEPTION 'Il negozio del reso deve essere quello dell ordine.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.buyer_id IS NOT NULL AND v_buyer IS NOT NULL AND NEW.buyer_id <> v_buyer THEN
    RAISE EXCEPTION 'Il cliente del reso deve essere quello dell ordine.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.returns_coerenti_con_l_ordine() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_returns_coerenti_con_l_ordine ON public.returns;
CREATE TRIGGER trg_returns_coerenti_con_l_ordine
  BEFORE INSERT OR UPDATE ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public.returns_coerenti_con_l_ordine();

COMMIT;

NOTIFY pgrst, 'reload schema';
