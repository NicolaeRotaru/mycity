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
