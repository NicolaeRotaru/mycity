-- Sei viste girano coi permessi di chi le ha create — e metterle a posto nel modo ovvio spegne il sito.
--
-- IL DIFETTO SEGNALATO. L'advisor di Supabase, livello ERRORE, elenca sei viste `SECURITY DEFINER`:
-- shop_of_month_leaderboard, sponsored_active_public, live_activity_public, rider_reviews_ricevute,
-- ordini_disponibili_rider, seller_public_profiles. Chi le interroga ottiene le righe coi permessi
-- del creatore, quindi le regole di lettura riga-per-riga delle tabelle sotto non vengono applicate.
--
-- QUELLO CHE HO MISURATO, E CHE CAMBIA LA RISPOSTA. Il rimedio ovvio e' una riga sola:
-- `ALTER VIEW … SET (security_invoker = true)`, cioe' «leggi coi permessi di chi interroga». L'ho
-- applicato su un Postgres 16 con tutte e 145 le migrazioni dentro e qualche riga vera seminata, e
-- ho contato le righe prima e dopo, per ogni vista e per il ruolo che la legge davvero:
--
--     vista                        oggi   con security_invoker = true
--     seller_public_profiles         1  →  0     l'elenco dei negozi, vuoto per chi non ha l'account
--     shop_of_month_leaderboard      1  →  0     il negozio del mese, vuoto
--     live_activity_public           1  →  0     «cosa sta succedendo adesso», vuota
--     sponsored_active_public        1  →  0     gli annunci pagati, spariti dalla home
--     ordini_disponibili_rider       1  →  0     la bacheca dei fattorini, VUOTA: nessuno puo' piu'
--                                                prendere un ordine
--     rider_consegne_storico         1  →  0     lo storico consegne del fattorino, vuoto
--
-- Non e' una sorpresa, guardando le regole: `profiles` si legge solo se e' il proprio profilo o se si
-- e' amministratori; `orders` solo se si e' il cliente, il venditore o il fattorino GIA' assegnato —
-- e la bacheca mostra apposta gli ordini che un fattorino NON ha ancora. Sotto queste viste non c'e'
-- nessuna regola che permetta la lettura pubblica, e non ci puo' essere: una regola sta sulla RIGA,
-- non sulla colonna. Aprire `profiles` «per i negozi approvati» vorrebbe dire aprire TUTTE le colonne
-- di quelle righe, non le venti della vetrina. Sarebbe peggio del difetto.
--
-- QUINDI: QUESTE VISTE SONO LA SCELTA GIUSTA, NON UN ERRORE. Una vista coi permessi del creatore e un
-- elenco di colonne stretto e' il modo corretto di mostrare al pubblico una fetta di una tabella
-- protetta. L'avviso dell'advisor, su queste sei, e' un falso allarme — ma resta vero finche' qualcuno
-- controlla le colonne, ed e' l'unica cosa che le tiene oneste. Il controllo che nessuno faceva ora
-- c'e' e gira da solo: tests/unit/nessuna-funzione-potente-in-mano-a-chi-non-ha-l-account.test.ts.
--
-- HO GUARDATO ANCHE LE COLONNE, UNA PER UNA. In `seller_public_profiles` ci sono ragione sociale,
-- partita IVA e sede: sembrano di troppo e non lo sono — le legge components/products/VendutoDa.tsx
-- (riga 25) per il riquadro «venduto da», che per legge deve dire al cliente chi e' il venditore
-- prima dell'acquisto. `stripe_charges_enabled` e `stripe_payouts_enabled` le legge il sito per
-- sapere se un negozio puo' incassare (lib/db/migrazione-124.ts). Nessuna colonna e' orfana: tolta
-- una, si rompe una pagina. Quindi qui non si stringe niente, e il perche' resta scritto.
--
-- COSA FA QUESTA MIGRAZIONE, in tre mosse.
--   ① Chiude ad `anon` `rider_consegne_storico`, che NESSUN avviso segnalava e che invece e' l'unica
--      falla vera del gruppo: la legge chiunque, senza account.
--   ② Mette `security_barrier = true` sulle viste che nascondono righe a chi le legge.
--   ③ Scrive nel database perche' queste viste restano coi permessi del creatore, cosi' che il
--      prossimo che legge l'avviso non «ripari» spegnendo la vetrina o la bacheca dei fattorini.
--
-- REVERSIBILE: `ALTER VIEW … RESET (security_barrier)` e `GRANT SELECT ON public.rider_consegne_storico
-- TO anon` rimettono la situazione di prima, cioe' il difetto.
--
-- COSA NON HO VERIFICATO DA QUI: la fuga di righe che `security_barrier` previene non sono riuscito a
-- riprodurla — su due righe di prova il pianificatore teneva gia' il filtro della vista per primo. Il
-- paletto lo metto lo stesso: il piano dipende dai dati, e con un catalogo vero puo' cambiare.

-- =========================================================
-- ① LO STORICO DEL FATTORINO NON E' ROBA DA VETRINA
-- =========================================================
-- La migrazione 127 (riga 760) scrive `GRANT SELECT ON public.rider_consegne_storico TO authenticated`
-- e si ferma li'. Ma qui una vista NASCE gia' concessa ad `anon` (privilegi di default di Supabase):
-- concederla a uno non la toglie all'altro. Risultato: chiunque, senza account, poteva leggere le
-- consegne fatte e i compensi (`rider_fee_cents`, `total_price`, la citta') — la vista filtra su
-- `auth.uid()`, che per un anonimo e' vuoto, quindi oggi non escono righe; ma il giorno in cui quel
-- filtro cambia, la porta e' gia' aperta e nessuno se ne accorge. La legge solo app/rider/history.
REVOKE ALL    ON public.rider_consegne_storico FROM PUBLIC, anon;
GRANT  SELECT ON public.rider_consegne_storico TO authenticated;

-- =========================================================
-- ② IL FILTRO DELLA VISTA VIENE PRIMA DI QUELLO DI CHI CHIEDE
-- =========================================================
-- Una vista coi permessi del creatore che nasconde righe deve essere una barriera: senza, il
-- pianificatore puo' anticipare una condizione scritta da chi interroga sotto il filtro della vista,
-- e un messaggio d'errore su una riga che doveva restare nascosta diventa una risposta.
ALTER VIEW public.seller_public_profiles    SET (security_barrier = true);
ALTER VIEW public.shop_of_month_leaderboard SET (security_barrier = true);
ALTER VIEW public.live_activity_public      SET (security_barrier = true);
ALTER VIEW public.sponsored_active_public   SET (security_barrier = true);
ALTER VIEW public.ordini_disponibili_rider  SET (security_barrier = true);
ALTER VIEW public.rider_reviews_ricevute    SET (security_barrier = true);
ALTER VIEW public.rider_consegne_storico    SET (security_barrier = true);

-- =========================================================
-- ③ LA SCELTA RESTA SCRITTA DOVE SI LEGGE L'AVVISO
-- =========================================================
COMMENT ON VIEW public.seller_public_profiles IS
  'Vetrina pubblica dei negozi approvati: coi permessi del creatore APPOSTA, perche profiles si legge solo per se stessi. Mettere security_invoker=true svuota l''elenco negozi per chi non ha l''account (misurato: 1 riga -> 0). La sicurezza qui sta nelle colonne: nessuna si aggiunge senza chiedersi se puo stare in vetrina.';
COMMENT ON VIEW public.shop_of_month_leaderboard IS
  'Classifica pubblica del negozio del mese: solo nome, logo e conteggio voti. Coi permessi del creatore apposta; con security_invoker=true resta vuota.';
COMMENT ON VIEW public.live_activity_public IS
  'Attivita del marketplace a blocchi di un''ora, senza identificativi di ordine. Coi permessi del creatore apposta; con security_invoker=true resta vuota.';
COMMENT ON VIEW public.sponsored_active_public IS
  'Annunci a pagamento attivi, senza prezzo pagato ne conteggi. Coi permessi del creatore apposta; con security_invoker=true la home resta senza annunci.';
COMMENT ON VIEW public.ordini_disponibili_rider IS
  'Bacheca degli ordini da prendere: si protegge da sola con is_rider_approvato(), che risponde su chi chiama. Coi permessi del creatore apposta — mostra ordini SENZA fattorino, che nessuna regola di lettura permetterebbe: con security_invoker=true la bacheca si svuota e nessuno puo piu prendere un ordine.';
COMMENT ON VIEW public.rider_reviews_ricevute IS
  'Recensioni ricevute dal fattorino che sta chiedendo (filtra su auth.uid()), col solo nome di battesimo di chi ha scritto. Non concederla ad anon.';
COMMENT ON VIEW public.rider_consegne_storico IS
  'Storico consegne e compensi del fattorino che sta chiedendo (filtra su auth.uid()). Solo per chi ha fatto l''accesso: non concederla ad anon.';

NOTIFY pgrst, 'reload schema';
