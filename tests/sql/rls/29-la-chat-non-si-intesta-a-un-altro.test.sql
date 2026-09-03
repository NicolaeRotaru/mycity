-- =============================================================================
-- Una chat non si intesta a un'altra persona
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- 3/9/2026 — CHI E' DENTRO UNA CHAT POTEVA FARLA LEGGERE A UN TERZO.
--
-- La regola di aggiornamento delle conversazioni (026) ha solo la parte USING:
-- «sono uno dei due partecipanti». Postgres, senza WITH CHECK, riusa quella
-- stessa condizione sulla riga nuova — e resta vera anche dopo aver sostituito
-- l'ALTRO partecipante. Nessuna colonna era protetta, nessun trigger faceva la
-- guardia.
--
-- Anna scrive al fornaio l'indirizzo e il telefono per la consegna, poi sposta
-- quella conversazione su Fiori Belli: Fiori Belli apre e legge tutto. Funziona
-- anche al contrario: il negozio intesta la chat della propria cliente a uno
-- sconosciuto, che si legge «lasciate i fiori dal portinaio, sono in ospedale
-- fino a venerdi». La visibilita' dei messaggi si decide dai partecipanti
-- ATTUALI: cambiato il partecipante, cambia chi legge lo storico.
--
-- COSA CONTROLLA. Prova il dirottamento nelle due direzioni con la sessione
-- vera di chi lo farebbe, e poi verifica che il segnare-come-letto — l'unica
-- scrittura che il sito fa davvero su questa tabella — continui a funzionare.
--
-- E LO CONTROLLA A DUE STRATI, che e' il punto di questo file. La riparazione
-- ha due gambe: il permesso sceso alla colonna (①) e il trigger guardiano (②).
-- I controlli ① ② ③ ④ ⑤ qui sotto misurano il risultato con il sito com'e'
-- oggi — e li' a respingere e' sempre il permesso: il trigger non gira
-- nemmeno una volta. Sarebbero verdi anche con il guardiano spento. Il
-- controllo ⑥ toglie quello strato apposta e misura il guardiano da solo.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- ------------------------------------------------------------------ personaggi
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('dd000000-0000-0000-0000-00000000000a', 'fornaio@test.it',    '{"role":"seller"}'),
  ('dd000000-0000-0000-0000-00000000000b', 'anna@test.it',       '{"role":"buyer"}'),
  ('dd000000-0000-0000-0000-00000000000c', 'fiori@test.it',      '{"role":"seller"}'),
  ('dd000000-0000-0000-0000-00000000000d', 'sconosciuto@test.it','{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'dd000000-0000-0000-0000-00000000000a';
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Fiori Belli'
 WHERE id = 'dd000000-0000-0000-0000-00000000000c';

RESET mycity.allow_profile_write;

-- La conversazione fra Anna e il fornaio, con dentro i dati di casa.
INSERT INTO public.conversations (id, buyer_id, seller_id, buyer_unread_count, seller_unread_count)
VALUES ('dd000000-1111-0000-0000-00000000000e',
        'dd000000-0000-0000-0000-00000000000b',
        'dd000000-0000-0000-0000-00000000000a', 3, 0);

INSERT INTO public.messages (conversation_id, sender_id, body)
VALUES ('dd000000-1111-0000-0000-00000000000e',
        'dd000000-0000-0000-0000-00000000000b',
        'Via Verdi 10, citofono Rossi, sono in ospedale fino a venerdi.');

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;

-- `esito` restituisce il codice, e sul rifiuto il codice e' 42501 sia che a
-- respingere sia il permesso di colonna sia che sia il trigger: identici visti
-- da fuori. `motivo` restituisce il MESSAGGIO, che invece dice chi ha parlato.
-- Serve al controllo ⑥, che deve poter distinguere i due strati.
CREATE OR REPLACE FUNCTION pg_temp.motivo(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END $$;

-- =============================================================================
-- ① LA CLIENTE NON SPOSTA LA CHAT SU UN ALTRO NEGOZIO
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.conversations
       SET seller_id = 'dd000000-0000-0000-0000-00000000000c'
     WHERE id = 'dd000000-1111-0000-0000-00000000000e'
  $q$);
  RESET ROLE;
  INSERT INTO esiti VALUES (
    'la cliente non gira la propria chat a un altro negozio',
    come <> 'PASSATO' AND (SELECT c.seller_id FROM public.conversations c
                            WHERE c.id = 'dd000000-1111-0000-0000-00000000000e')
                          = 'dd000000-0000-0000-0000-00000000000a',
    CASE WHEN come = 'PASSATO'
         THEN 'PASSATO: il fioraio legge lo scambio col fornaio'
         ELSE 'respinto (' || come || ')' END
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ② IL NEGOZIO NON GIRA LA CHAT DELLA PROPRIA CLIENTE A UNO SCONOSCIUTO
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.conversations
       SET buyer_id = 'dd000000-0000-0000-0000-00000000000d'
     WHERE id = 'dd000000-1111-0000-0000-00000000000e'
  $q$);
  RESET ROLE;
  INSERT INTO esiti VALUES (
    'il negozio non gira la chat della cliente a uno sconosciuto',
    come <> 'PASSATO' AND (SELECT c.buyer_id FROM public.conversations c
                            WHERE c.id = 'dd000000-1111-0000-0000-00000000000e')
                          = 'dd000000-0000-0000-0000-00000000000b',
    CASE WHEN come = 'PASSATO'
         THEN 'PASSATO: uno sconosciuto legge dove abita Anna e quando non c e'
         ELSE 'respinto (' || come || ')' END
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ③ QUELLO CHE NON SI DEVE ROMPERE — segnare come letto
--    E' l'unica scrittura che il sito fa su questa tabella con la sessione di
--    una persona (/api/chat/mark-read).
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text; contatore int;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.conversations SET buyer_unread_count = 0
     WHERE id = 'dd000000-1111-0000-0000-00000000000e'
  $q$);
  RESET ROLE;
  SELECT c.buyer_unread_count INTO contatore FROM public.conversations c
   WHERE c.id = 'dd000000-1111-0000-0000-00000000000e';
  INSERT INTO esiti VALUES (
    'la cliente azzera ancora i propri messaggi non letti',
    come = 'PASSATO' AND contatore = 0,
    format('esito %s, contatore %s (atteso 0)', come, contatore)
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ④ QUELLO CHE NON SI DEVE ROMPERE — un messaggio nuovo aggiorna l'anteprima
--    La scrive il trigger update_conversation_on_message, che gira coi permessi
--    di chi l'ha creato: deve continuare a funzionare anche ora che a
--    `authenticated` restano solo due colonne.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE come text; anteprima text; nonletti int;
BEGIN
  come := pg_temp.esito($q$
    INSERT INTO public.messages (conversation_id, sender_id, body)
    VALUES ('dd000000-1111-0000-0000-00000000000e',
            'dd000000-0000-0000-0000-00000000000a',
            'Va bene Anna, lascio il pane dal portinaio.')
  $q$);
  RESET ROLE;
  SELECT c.last_message_preview, c.buyer_unread_count INTO anteprima, nonletti
    FROM public.conversations c WHERE c.id = 'dd000000-1111-0000-0000-00000000000e';
  INSERT INTO esiti VALUES (
    'il messaggio del negozio aggiorna anteprima e non letti della cliente',
    come = 'PASSATO' AND anteprima LIKE 'Va bene Anna%' AND nonletti = 1,
    format('esito %s, anteprima «%s», non letti %s (atteso 1)', come, coalesce(anteprima, '—'), nonletti)
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ⑤ IL PERMESSO NON E' PIU' SULL'INTERA TABELLA
--    E' la difesa che regge anche se un domani qualcuno riscrive la regola.
-- =============================================================================
DO $$
DECLARE largo boolean;
BEGIN
  largo := has_table_privilege('authenticated', 'public.conversations', 'UPDATE');
  INSERT INTO esiti VALUES (
    'chi ha l account non puo aggiornare tutta la tabella delle chat',
    NOT largo,
    CASE WHEN largo THEN 'PASSATO: il permesso e ancora su tutte le colonne'
         ELSE 'il permesso vive solo sui due contatori' END
  );
END $$;

-- =============================================================================
-- ⑥ IL GUARDIANO DA SOLO, SENZA LO STRATO DEL PERMESSO E CON IL PROPRIETARIO
--    CHE HA IN PRODUZIONE
--
--    Perche' esiste questo controllo (3/9/2026, revisione di sicurezza).
--    I controlli ① e ② dicono il vero — la chat non si sposta — ma a respingerli
--    e' il permesso di colonna della mossa ①, che nega la scrittura prima che il
--    trigger venga eseguito. Il trigger non era mai stato provato nemmeno una
--    volta: erano verdi per un motivo diverso da quello che credevano di
--    misurare.
--
--    Qui si toglie quello strato — si riconcede l'UPDATE su tutta la tabella,
--    cioe' esattamente cio' che farebbe il ciclo della 145 se rigirasse dopo la
--    154 — e resta in piedi solo il guardiano. Che e' il caso che la migrazione
--    dichiara di coprire.
--
--    E si prova con la funzione intestata ai tre nomi «da amministratore».
--    Motivo: dentro una funzione SECURITY DEFINER `current_user` non e' chi
--    chiama, e' il PROPRIETARIO della funzione. Su Supabase le migrazioni si
--    applicano come `postgres`, quindi la funzione nasce di `postgres`: un
--    guardiano che si fidasse di `current_user` si autorizzerebbe da solo e non
--    scatterebbe mai. In locale la funzione nasce di un altro utente, quindi
--    senza questo giro sul proprietario il difetto resta invisibile — ed e'
--    proprio cosi' che era passato.
--
--    Il controllo pretende tre cose insieme: la scrittura respinta, la riga
--    rimasta com'era, e il rifiuto arrivato DAL TRIGGER (lo si riconosce dal
--    messaggio: il permesso dice «permission denied», il guardiano dice «non si
--    intesta»).
-- =============================================================================
GRANT UPDATE ON public.conversations TO authenticated;

DO $$
DECLARE
  proprietario  text;
  originale     text := pg_get_userbyid((SELECT p.proowner FROM pg_proc p
                          JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public'
                           AND p.proname = 'conversazione_non_si_reintesta'));
  come          text;
  seller_dopo   uuid;
  guasti        text := '';
BEGIN
  FOREACH proprietario IN ARRAY ARRAY['postgres', 'supabase_admin', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = proprietario) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', proprietario);
    END IF;
    -- Su Supabase questi tre nomi vedono lo schema `auth`; il ruolo che
    -- l'impalcatura locale inventa al volo no. Senza questa riga il trigger
    -- morirebbe su `auth.jwt()` con «permission denied for schema auth» — un
    -- rosso che parla del banco di prova, non del guardiano.
    EXECUTE format('GRANT USAGE ON SCHEMA auth TO %I', proprietario);
    EXECUTE format('GRANT CREATE ON SCHEMA public TO %I', proprietario);
    EXECUTE format('ALTER FUNCTION public.conversazione_non_si_reintesta() OWNER TO %I', proprietario);

    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000b","role":"authenticated"}';
    come := pg_temp.motivo($q$
      UPDATE public.conversations
         SET seller_id = 'dd000000-0000-0000-0000-00000000000c'
       WHERE id = 'dd000000-1111-0000-0000-00000000000e'
    $q$);
    RESET request.jwt.claims;
    RESET ROLE;

    SELECT c.seller_id INTO seller_dopo FROM public.conversations c
     WHERE c.id = 'dd000000-1111-0000-0000-00000000000e';

    IF seller_dopo IS DISTINCT FROM 'dd000000-0000-0000-0000-00000000000a'::uuid THEN
      guasti := guasti || format('funzione di %s: la chat si e spostata sul fioraio; ', proprietario);
      -- si rimette a posto per il giro dopo, dalla porta di servizio dichiarata
      SET LOCAL mycity.allow_conversation_reassign = '1';
      UPDATE public.conversations SET seller_id = 'dd000000-0000-0000-0000-00000000000a'
       WHERE id = 'dd000000-1111-0000-0000-00000000000e';
      RESET mycity.allow_conversation_reassign;
    ELSIF come NOT ILIKE '%non si intesta%' THEN
      guasti := guasti || format('funzione di %s: respinta da un altro strato, non dal guardiano (%s); ',
                                 proprietario, come);
    END IF;
  END LOOP;

  EXECUTE format('ALTER FUNCTION public.conversazione_non_si_reintesta() OWNER TO %I', originale);

  INSERT INTO esiti VALUES (
    'il guardiano ferma il dirottamento anche se il permesso torna largo',
    guasti = '',
    CASE WHEN guasti = '' THEN 'respinto dal trigger con tutti e tre i proprietari'
         ELSE 'PASSATO: ' || guasti END
  );
END $$;

-- =============================================================================
-- ⑦ LE PORTE DI SERVIZIO DICHIARATE RESTANO APERTE
--    Un guardiano che blocca tutti e' rotto quanto uno spento: il backend con la
--    chiave di servizio e una manutenzione che si dichiara devono poter ancora
--    staccare o rifare un'intestazione (per esempio dopo una fusione di account).
--    Il permesso di tabella e' ancora largo dal controllo ⑥: qui si misura solo
--    la decisione del guardiano.
-- =============================================================================
DO $$
DECLARE come_servizio text; come_manutenzione text; chi uuid;
BEGIN
  -- (a) il backend, che si presenta col ruolo di servizio nel token
  SET LOCAL ROLE service_role;
  SET LOCAL request.jwt.claims = '{"role":"service_role"}';
  come_servizio := pg_temp.motivo($q$
    UPDATE public.conversations SET seller_id = 'dd000000-0000-0000-0000-00000000000c'
     WHERE id = 'dd000000-1111-0000-0000-00000000000e'
  $q$);
  RESET request.jwt.claims;
  RESET ROLE;

  -- (b) la manutenzione, che deve dichiararlo prima di farlo
  SET LOCAL mycity.allow_conversation_reassign = '1';
  come_manutenzione := pg_temp.motivo($q$
    UPDATE public.conversations SET seller_id = 'dd000000-0000-0000-0000-00000000000a'
     WHERE id = 'dd000000-1111-0000-0000-00000000000e'
  $q$);
  RESET mycity.allow_conversation_reassign;

  SELECT c.seller_id INTO chi FROM public.conversations c
   WHERE c.id = 'dd000000-1111-0000-0000-00000000000e';

  INSERT INTO esiti VALUES (
    'la chiave di servizio e la manutenzione dichiarata passano ancora',
    come_servizio = 'PASSATO' AND come_manutenzione = 'PASSATO'
      AND chi = 'dd000000-0000-0000-0000-00000000000a',
    format('chiave di servizio: %s · manutenzione dichiarata: %s', come_servizio, come_manutenzione)
  );
END $$;

REVOKE UPDATE ON public.conversations FROM authenticated;
GRANT UPDATE (buyer_unread_count, seller_unread_count) ON public.conversations TO authenticated;

-- =============================================================================
-- ⑧ NESSUN GUARDIANO SI FIDA DI `current_user` — in tutto lo schema, non solo qui
--
--    Questa non e' una regola sulle chat: e' il cancello che impedisce alla
--    stessa malattia di rinascere altrove. Dentro una funzione SECURITY DEFINER
--    `current_user` e' il proprietario della funzione, non chi ha chiamato: un
--    controllo di permessi scritto cosi' finisce per autorizzare se stesso e
--    sembra acceso mentre e' spento. E' il difetto che la revisione del 3/9/2026
--    ha trovato nella 154, ed e' il tipo peggiore, perche' nessuno lo va piu' a
--    cercare.
--
--    Non e' una ricerca di parole nei file: guarda il database VERO ricostruito
--    da tutte le migrazioni, quindi vede anche le funzioni create da un ciclo o
--    da un `EXECUTE`. E guarda il CODICE, non la prosa: i commenti si tolgono
--    prima di cercare, cosi' una funzione puo' spiegare la trappola per iscritto
--    senza far scattare il controllo. `session_user` non lo tocca: quello e'
--    l'utente della connessione, e una SECURITY DEFINER non lo cambia.
--
--    Chi ha davvero bisogno di sapere chi possiede la funzione lo scriva in un
--    altro modo e lo spieghi qui: questo controllo va aggiornato di proposito,
--    non aggirato.
-- =============================================================================
DO $$
DECLARE elenco text;
BEGIN
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY p.proname) INTO elenco
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosecdef
     AND n.nspname = 'public'
     -- via i commenti a blocco, poi quelli di riga: resta il codice eseguito
     AND regexp_replace(
           regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
           '--[^\n]*', ' ', 'g')
         ~ '(^|[^._[:alnum:]])current_user([^._[:alnum:]]|$)';

  INSERT INTO esiti VALUES (
    'nessuna funzione potente decide i permessi guardando current_user',
    elenco IS NULL,
    CASE WHEN elenco IS NULL
         THEN 'nessuna funzione SECURITY DEFINER di public guarda current_user'
         ELSE 'PASSATO: si fidano di current_user → ' || elenco END
  );
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulle chat:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la chat resta di chi la fa: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
