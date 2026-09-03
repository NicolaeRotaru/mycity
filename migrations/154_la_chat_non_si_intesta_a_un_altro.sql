-- Chi e' dentro una chat poteva intestarla a un'altra persona, che si leggeva tutto lo storico.
--
-- IL DIFETTO (radiografia del 3/9/2026). La regola di aggiornamento delle conversazioni, nata con la
-- migrazione 026, e' questa:
--
--     create policy conversations_update_participants on public.conversations
--       for update using (auth.uid() = buyer_id or auth.uid() = seller_id);
--
-- Ha solo la parte USING. Postgres, quando manca il WITH CHECK, riusa la USING anche per la riga
-- NUOVA — e la condizione «sono uno dei due partecipanti» resta vera anche DOPO aver sostituito
-- l'altro. Nessuna colonna e' protetta e nessun trigger fa la guardia (su `orders` c'e'
-- `enforce_order_update_rules`, su `subscription_orders` c'e' `subscription_orders_campi_bloccati`:
-- qui non c'era niente).
--
-- Cosa vuol dire, in concreto, in tutte e due le direzioni:
--   · Anna scrive al fornaio l'indirizzo e il telefono per la consegna, poi sposta quella chat su
--     Fiori Belli. Fiori Belli apre la conversazione e legge tutto lo scambio col fornaio.
--   · Fiori Belli intesta la chat di una sua cliente a un terzo sconosciuto, che legge «lasciate i
--     fiori dal portinaio, sono in ospedale fino a venerdi».
-- La visibilita' dei messaggi (`messages_select_participants`) si decide dai partecipanti ATTUALI
-- della conversazione: cambiato il partecipante, cambia chi legge lo storico. Sono dati personali —
-- indirizzi, telefoni, assenze da casa, condizioni di salute — girati a una terza persona senza
-- nessun consenso.
--
-- Il sito non ha nessuna schermata che cambi `buyer_id` o `seller_id`: la porta si apre solo
-- chiamando il database a mano con il proprio token. Che e' esattamente quello che fa chi ci prova.
--
-- LA CAUSA: il permesso era per TABELLA mentre il bisogno e' per COLONNA. L'unica scrittura che il
-- sito fa davvero su questa tabella con la sessione di una persona e' `/api/chat/mark-read`, che
-- azzera il proprio contatore dei non letti. Anteprima e data dell'ultimo messaggio le scrive il
-- trigger `update_conversation_on_message`, che e' SECURITY DEFINER: gira coi permessi di chi l'ha
-- creato, quindi non ha bisogno di nessun permesso concesso a `authenticated`.
--
-- COSA FA QUESTA MIGRAZIONE, in due mosse.
--
-- ① IL PERMESSO SCENDE DALLA TABELLA ALLA COLONNA. Si toglie l'aggiornamento su tutta la tabella e
--    si riconcede sui due soli contatori dei non letti. Da qui in avanti `buyer_id` e `seller_id`
--    non sono scrivibili: non e' una regola da valutare riga per riga, e' una colonna che quel ruolo
--    non ha. E' la stessa idea della 145, un gradino piu' fine.
--
-- ② UN GUARDIANO CHE NON DIPENDE DAI PERMESSI. Il ciclo della 145 riconcede l'aggiornamento a tutte
--    le tabelle che hanno una regola permissiva di UPDATE, e `conversations_update_participants` e'
--    esattamente quella: se un domani quel ciclo venisse rieseguito DOPO questa migrazione, il
--    permesso sull'intera tabella tornerebbe e la ① sarebbe cancellata in silenzio. Il trigger no:
--    rifiuta il cambio di intestazione a chiunque non sia amministratore o la chiave di servizio,
--    qualunque permesso abbia.
--
-- COSA NON TOCCA. La lettura resta com'e'. L'apertura di una conversazione nuova resta com'e'
-- (`conversations_insert_buyer`). Il segnare come letto continua a funzionare. La cancellazione di un
-- account continua a staccare il legame mettendo la colonna a vuoto (122): il guardiano lo ammette.
--
-- SE NICOLA NON LA APPLICA: il buco resta aperto per intero, e non c'e' nessuna gamba nel codice che
-- lo copra — non essendoci nessuna schermata che fa questa operazione, non c'e' niente da riparare
-- lato sito. Chiunque abbia un account e una chat aperta puo', con una sola chiamata al database,
-- far leggere a un terzo tutto lo scambio privato dell'altra persona: indirizzo di casa, telefono,
-- quando non c'e' nessuno in casa. E' l'unica riparazione possibile per questo difetto.
--
-- REVERSIBILE:
--   DROP TRIGGER IF EXISTS trg_conversazione_non_si_reintesta ON public.conversations;
--   DROP FUNCTION IF EXISTS public.conversazione_non_si_reintesta();
--   GRANT UPDATE ON public.conversations TO authenticated;
-- (cioe' il difetto di prima).
--
-- LA PROVA: tests/sql/rls/29-la-chat-non-si-intesta-a-un-altro.test.sql

BEGIN;

-- ── ① Il permesso scende dalla tabella alla colonna ──────────────────────────
REVOKE UPDATE ON public.conversations FROM anon, authenticated;

GRANT UPDATE (buyer_unread_count, seller_unread_count)
  ON public.conversations TO authenticated;

-- ── ② Il guardiano dell'intestazione ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conversazione_non_si_reintesta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Le due forme in cui arriva il backend: il ruolo dichiarato nel token e il
  -- ruolo con cui PostgREST esegue davvero la richiesta. Servono tutte e due:
  -- fuori da PostgREST (manutenzione, ripristino) il token non c'e'.
  privilegiato boolean := public.is_admin()
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR current_user IN ('service_role', 'postgres', 'supabase_admin');
BEGIN
  IF privilegiato THEN
    RETURN NEW;
  END IF;

  -- Il legame che si stacca alla cancellazione di un account (122) resta lecito.
  IF NEW.buyer_id IS DISTINCT FROM OLD.buyer_id AND NEW.buyer_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una conversazione non si intesta a un altro cliente.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.seller_id IS DISTINCT FROM OLD.seller_id AND NEW.seller_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una conversazione non si intesta a un altro negozio.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conversazione_non_si_reintesta() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conversazione_non_si_reintesta ON public.conversations;
CREATE TRIGGER trg_conversazione_non_si_reintesta
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversazione_non_si_reintesta();

COMMIT;

NOTIFY pgrst, 'reload schema';
