-- Non ci si iscrive a un evento finito o annullato: la regola la tiene il database.
--
-- IL DIFETTO (palestra del 7/11). La regola event_rsvps_own_rw (034) guarda solo DI CHI e' la riga,
-- non l'evento: un cliente collegato poteva iscriversi a un evento gia' finito, annullato o chiuso
-- dall'amministratore, e il conto dei partecipanti di quell'evento cresceva. La pagina Eventi non lo
-- lascia piu' premere, ma la pagina non e' la regola: una chiamata diretta passava lo stesso.
--
-- LA CURA. Una regola in piu', RESTRICTIVE e solo per l'INSERT: vale in AND con quella che c'e', che
-- non si tocca. Una riga nuova entra solo se l'evento esiste, e' «scheduled» o «live» e non e' ancora
-- finito (ends_at > now()). Gli eventi in programma o in corso li legge chiunque (events_public_read),
-- quindi il controllo vede l'evento anche girando coi permessi di chi si iscrive.
--
-- COSA NON FA. Il DELETE resta com'e': cancellarsi da un evento finito e' ancora ammesso dal database
-- (se vietarlo lo decide Nicola). Le iscrizioni gia' scritte non si toccano.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: DROP POLICY event_rsvps_solo_eventi_aperti ON public.event_rsvps;

DROP POLICY IF EXISTS event_rsvps_solo_eventi_aperti ON public.event_rsvps;
CREATE POLICY event_rsvps_solo_eventi_aperti ON public.event_rsvps
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.marketplace_events e
       WHERE e.id = event_rsvps.event_id
         AND e.status IN ('scheduled', 'live')
         AND e.ends_at > now()
    )
  );
