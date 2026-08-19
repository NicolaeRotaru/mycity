-- =============================================================================
-- 121 — I conteggi pubblici tornano visibili, senza rimettere in piazza i nomi
-- =============================================================================
-- Cosa e' successo. La migrazione 119 ha chiuso un buco vero: `event_rsvps` e
-- `shop_of_month_votes` avevano `FOR SELECT USING (true)`, cioe' con la chiave
-- del browser si scaricava nome per nome chi partecipa a un evento e chi ha
-- votato quale negozio. Tolte quelle due policy, e messe al loro posto tre
-- funzioni che restituiscono SOLO il numero.
--
-- Quello che non avevo fatto: collegare le pagine alle funzioni nuove. Risultato
-- in produzione, dalle 20:25 del 19 agosto: la pagina degli eventi mostrava zero
-- partecipanti a tutti gli eventi, e la classifica del negozio del mese mostrava
-- zero voti a tutti i negozi. Nessun dato perso — solo numeri che non si vedono
-- piu' — ma sono due pagine che dicono il falso a chi le apre.
--
-- La riparazione qui e' per la classifica; quella della pagina eventi e' nel
-- codice (app/events/page.tsx passa alla funzione event_rsvp_counts).
--
-- Perche' cosi'. `shop_of_month_leaderboard` espone gia' soltanto il conteggio
-- per negozio: seller_id, nome, logo, mese, numero di voti. Chi ha votato non
-- c'e'. Farla leggere coi permessi di chi la possiede — invece che con quelli di
-- chi la chiama — rimette i numeri e NON riapre il buco: la tabella grezza
-- resta chiusa. Il risultato e' piu' stretto di com'era prima della 119, non
-- piu' largo.
-- =============================================================================

BEGIN;

ALTER VIEW public.shop_of_month_leaderboard SET (security_invoker = off);

-- La lettura del solo aggregato torna a tutti; la tabella sotto resta chiusa
-- alle righe proprie, come l'ha lasciata la 119.
GRANT SELECT ON public.shop_of_month_leaderboard TO anon, authenticated;

COMMENT ON VIEW public.shop_of_month_leaderboard IS
  'Classifica del negozio del mese: solo conteggi per negozio, mai chi ha votato. Legge coi permessi del proprietario (security_invoker off) apposta: la tabella shop_of_month_votes resta leggibile solo dal votante, e da qui non trapela nessuna identita.';

COMMIT;
