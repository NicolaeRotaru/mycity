-- =============================================================================
-- Nessuna porta nuova si apre agli anonimi (il freno, non la toppa)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE, E PERCHE' NON BASTAVA IL 09.
--
-- Il 09 controlla per nome otto funzioni: se una di quelle si riapre, diventa
-- rosso. E' la toppa sulle porte che sappiamo esistere. Non ferma la nona.
--
-- La radiografia del 21/8/2026 ha misurato la causa radice: in PostgreSQL una
-- funzione nasce con EXECUTE concesso a PUBLIC, cioe' a chiunque, e i divieti
-- scritti nelle migrazioni dicevano `FROM anon, authenticated` — due
-- destinatari che non avevano un permesso proprio da togliere. La riga sembrava
-- chiudere e non chiudeva niente. E' stata scritta cosi' cinque volte in due
-- migrazioni diverse, a tre giorni di distanza: nessuno e' tornato a
-- controllare, perche' il file diceva che era a posto.
--
-- Questo controllo guarda il CATALOGO, non il file. Chiede a Postgres chi puo'
-- davvero eseguire cosa. Una funzione SECURITY DEFINER nuova che nasce aperta a
-- `anon` fa diventare rosso questo file il giorno stesso in cui entra nel repo,
-- anche se nessuno sapeva di doverla mettere in una lista.
--
-- La lista bianca qui sotto sono le funzioni che DEVONO restare pubbliche: le
-- vetrine, i conteggi, il tracciamento anonimo. Aggiungerne una e' una scelta
-- che si scrive e si discute in una richiesta di unione — che e' esattamente il
-- contrario di una porta che si apre in silenzio.
--
-- Tutto in transazione, ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- ① Nessuna funzione SECURITY DEFINER fuori lista e' in mano a un anonimo
-- ---------------------------------------------------------------------------
INSERT INTO esiti
SELECT 'nessuna funzione potente nuova e'' aperta agli anonimi',
       count(*) = 0,
       CASE WHEN count(*) = 0
            THEN 'fuori lista bianca: nessuna'
            ELSE 'fuori lista bianca: ' || string_agg(nome, ', ' ORDER BY nome) END
  FROM (
    SELECT p.proname AS nome
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname NOT IN (
         -- ESENZIONI DICHIARATE. Ognuna serve al sito pubblico, senza account.
         'event_rsvp_count',            -- quanti vanno all'evento
         'event_rsvp_counts',           -- gli stessi conteggi, in blocco
         'get_referral_leaderboard',    -- classifica pubblica degli inviti
         'is_admin',                    -- risponde solo su chi chiama
         'is_rider_approvato',          -- risponde solo su chi chiama
         'product_active_discounts',    -- i prezzi scontati in vetrina
         'referral_reward_fisso',       -- il premio invito, un numero solo
         'shop_of_month_vote_counts',   -- i voti del negozio del mese
         'store_cards',                 -- le schede negozio della home
         'store_follower_count',        -- quanti seguono un negozio
         'track_sponsored_click',       -- tracciamento, scrive solo un contatore
         'track_sponsored_impression',  -- idem
         'track_story_view',            -- idem
         -- 22/8/2026 — le tre domande che i filtri del catalogo facevano nel
         -- browser. Servono al sito pubblico, senza account: chi cerca
         -- «aperto adesso» spesso non ha ancora fatto l'accesso. Nessuna delle
         -- tre espone un dato che non sia gia' in vetrina.
         'negozi_aperti_adesso',        -- quali negozi sono aperti in questo momento
         'prodotti_con_voto_almeno',    -- i prodotti col voto medio minimo
         'categorie_per_negozio',       -- quali categorie tocca ogni negozio
         -- 28/8/2026 — le tre della riparazione del catalogo (migrazione 129).
         -- Il catalogo era invisibile a chi non ha l'account perche' le regole
         -- di lettura chiedevano «il negozio e' approvato?» dentro `profiles`,
         -- che a un estraneo e' chiusa. Le prime due rispondono si'/no su un id
         -- che il chiamante ha gia' in mano: nessuna riga esce. La terza
         -- restituisce solo id e conteggio delle visite, mai chi ha guardato.
         'negozio_approvato',           -- il negozio e' approvato? si'/no
         'prodotto_in_vetrina',         -- il prodotto e' in vetrina? si'/no
         'trending_product_ids_24h'     -- i piu' visti: solo id e conteggio
       )
  ) fuori_lista;

-- ---------------------------------------------------------------------------
-- ② La stessa domanda per chi ha fatto l'accesso, sui soldi
-- ---------------------------------------------------------------------------
-- `accumula_rimborso` e `storna_rimborso` decidono quanto un negozio incassa.
-- Non devono stare in mano a nessun browser, nemmeno a quello di un cliente
-- con l'account.
INSERT INTO esiti
SELECT 'i due conti del rimborso restano solo al server',
       count(*) = 0,
       CASE WHEN count(*) = 0
            THEN 'nessun ruolo del browser li puo'' chiamare'
            ELSE 'raggiungibili: ' || string_agg(nome || ' da ' || ruolo, ', ') END
  FROM (
    SELECT p.proname AS nome, r.ruolo
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(ruolo)
     WHERE n.nspname = 'public'
       AND p.proname IN ('accumula_rimborso', 'storna_rimborso')
       AND has_function_privilege(r.ruolo, p.oid, 'EXECUTE')
  ) aperte;

-- ---------------------------------------------------------------------------
-- ③ La vetrina «attivita' dal vivo» non regala piu' l'identita' degli ordini
-- ---------------------------------------------------------------------------
-- La forma vecchia dava `o.id` e l'orario al secondo: bastava leggerla a
-- intervalli per contare gli ordini di ogni negozio, e quegli id erano la
-- materia prima del bloccante su accumula_rimborso. La migrazione 120 li
-- toglie. Questo controllo e' quello che impedisce a una modifica futura di
-- rimetterli dentro senza accorgersene.
INSERT INTO esiti
SELECT 'la vetrina non espone l''identificativo degli ordini',
       count(*) = 0,
       CASE WHEN count(*) = 0
            THEN 'colonne che identificano: nessuna'
            ELSE 'colonne di troppo: ' || string_agg(column_name, ', ') END
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'live_activity_public'
   AND column_name IN ('id', 'order_id', 'user_id', 'delivery_full_name', 'delivery_phone', 'delivery_address');

-- ---------------------------------------------------------------------------
-- ④ La forma giusta del divieto, dove conta: nessun REVOKE «FROM anon,
--    authenticated» senza PUBLIC nelle migrazioni piu' recenti
-- ---------------------------------------------------------------------------
-- Questo non si puo' chiedere al catalogo — e' una domanda sul testo — ma il
-- catalogo risponde alla domanda vera, che e' ①. Qui si controlla soltanto che
-- le quattro funzioni della causa radice siano effettivamente chiuse, cioe' che
-- il rimedio sia arrivato fino in fondo e non solo sulla carta.
INSERT INTO esiti
SELECT 'le quattro funzioni della causa radice sono chiuse davvero',
       count(*) = 0,
       CASE WHEN count(*) = 0
            THEN 'tutte chiuse ad anon'
            ELSE 'ancora aperte: ' || string_agg(proname, ', ') END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('accumula_rimborso', 'pota_consent_log',
                     'consolida_visite_prodotto', 'documenti_da_cancellare_respinti')
   AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;
