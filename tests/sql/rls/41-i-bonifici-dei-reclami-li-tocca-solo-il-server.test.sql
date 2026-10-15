-- =============================================================================
-- I bonifici dei reclami li scrive e li legge solo il server
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- 15/10/2026 (collaudo di R71) — Un reclamo chiuso a favore del cliente su un
-- ordine in contanti si rimborsa col bonifico, che chi amministra fa a mano.
-- Prima l'unica traccia di quel bonifico era l'avviso nella campanella. La
-- migrazione 162 gli da' una riga in `bonifici_dei_reclami`, letta dalla lista
-- dei bonifici da fare.
--
-- Quella lista dice a chi paga QUANTO pagare. Se il cliente potesse scriverci,
-- potrebbe mettersi in lista da solo: la regola di inserimento dei reclami
-- (063) gli lascia scrivere la riga del reclamo intera, stato compreso — per
-- questo la cifra non sta su `disputes` ma qui, dove il browser non arriva.
--
-- COSA CONTROLLA. Il cliente prova a scriversi un bonifico e a leggere la
-- tabella; il negozio prova a leggerla; il server scrive e legge; una cifra
-- zero o negativa non entra; il reclamo del cliente si apre come prima; e il
-- bonifico che dobbiamo al cliente resta in lista anche se lui cancella
-- l'account (secondo giro di collaudo: con la chiave a cascata spariva).
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- ------------------------------------------------------------------ personaggi
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('ee000000-0000-0000-0000-00000000000a', 'fiori@test.it', '{"role":"seller"}'),
  ('ee000000-0000-0000-0000-00000000000b', 'marco@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Fiori del Duomo'
 WHERE id = 'ee000000-0000-0000-0000-00000000000a';

-- Un mazzo da 24 euro pagato in contanti al fattorino, consegnato ieri.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, delivered_at, cash_confirmed_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'ee000000-1111-0000-0000-00000000000c',
  'ee000000-0000-0000-0000-00000000000b',
  'ee000000-0000-0000-0000-00000000000a',
  24.00, 2400, 'cod', 'PAID', 'DELIVERED', now() - interval '1 day', now() - interval '1 day',
  'Marco Rossi', '3331234567', 'Via Roma 2', 'Piacenza', '29121'
);

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- Il reclamo di Marco, gia' chiuso a suo favore dal server.
SET LOCAL ROLE service_role;
INSERT INTO public.disputes (id, order_id, opener_id, against_id, reason, description, status, refund_cents)
VALUES ('ee000000-2222-0000-0000-00000000000d',
        'ee000000-1111-0000-0000-00000000000c',
        'ee000000-0000-0000-0000-00000000000b',
        'ee000000-0000-0000-0000-00000000000a',
        'DAMAGED', 'I fiori sono arrivati appassiti e la scatola era rotta.', 'resolved_buyer', 2400);
RESET ROLE;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

-- =============================================================================
-- ① IL CASO DA FERMARE — il cliente si mette in lista un bonifico da solo.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"ee000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    INSERT INTO public.bonifici_dei_reclami (dispute_id, order_id, importo_cents)
    VALUES ('ee000000-2222-0000-0000-00000000000d', 'ee000000-1111-0000-0000-00000000000c', 99900)
  $q$);
  INSERT INTO esiti VALUES (
    'il cliente non si scrive un bonifico da fare',
    come <> 'PASSATO',
    CASE WHEN come = 'PASSATO'
         THEN 'PASSATO: il cliente compare nella lista di chi paga con la cifra che vuole'
         ELSE 'respinto (' || come || ')' END
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ② IL SERVER SCRIVE E LEGGE — e' lui che registra il bonifico e lo segna fatto.
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE c1 text; c2 text; v int;
BEGIN
  c1 := pg_temp.esito($q$
    INSERT INTO public.bonifici_dei_reclami (dispute_id, order_id, importo_cents)
    VALUES ('ee000000-2222-0000-0000-00000000000d', 'ee000000-1111-0000-0000-00000000000c', 2400)
  $q$);
  c2 := pg_temp.esito($q$
    UPDATE public.bonifici_dei_reclami SET fatto_at = now()
     WHERE dispute_id = 'ee000000-2222-0000-0000-00000000000d' AND fatto_at IS NULL
  $q$);
  SELECT importo_cents INTO v FROM public.bonifici_dei_reclami
   WHERE dispute_id = 'ee000000-2222-0000-0000-00000000000d';
  INSERT INTO esiti VALUES (
    'il server registra il bonifico del reclamo, lo legge e lo segna fatto',
    c1 = 'PASSATO' AND c2 = 'PASSATO' AND v = 2400,
    format('inserimento %s, segno %s, cifra letta %s', c1, c2, coalesce(v::text, 'niente'))
  );
END $$;
RESET ROLE;

-- =============================================================================
-- ③ NESSUN BROWSER LA LEGGE — ne' il cliente ne' il negozio.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"ee000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$ SELECT * FROM public.bonifici_dei_reclami $q$);
  INSERT INTO esiti VALUES (
    'il negozio non legge i bonifici dei reclami',
    come <> 'PASSATO', format('lettura: %s', come));
END $$;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$ SELECT * FROM public.bonifici_dei_reclami $q$);
  INSERT INTO esiti VALUES (
    'chi non ha fatto l accesso non legge i bonifici dei reclami',
    come <> 'PASSATO', format('lettura: %s', come));
END $$;
RESET ROLE;

-- =============================================================================
-- ④ LA CIFRA DICE UNA COSA VERA — anche se scrive il server.
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE c1 text;
BEGIN
  c1 := pg_temp.esito($q$
    UPDATE public.bonifici_dei_reclami SET importo_cents = 0
     WHERE dispute_id = 'ee000000-2222-0000-0000-00000000000d'
  $q$);
  INSERT INTO esiti VALUES (
    'un bonifico da zero euro non entra',
    c1 <> 'PASSATO', format('esito: %s', c1));
END $$;
RESET ROLE;

-- =============================================================================
-- ⑤ QUELLO CHE NON SI DEVE ROMPERE — il cliente apre un reclamo come prima.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"ee000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  -- Le stesse colonne di app/orders/[id]/dispute/page.tsx.
  come := pg_temp.esito($q$
    INSERT INTO public.disputes (order_id, opener_id, against_id, reason, description)
    VALUES ('ee000000-1111-0000-0000-00000000000c', 'ee000000-0000-0000-0000-00000000000b',
            'ee000000-0000-0000-0000-00000000000a', 'OTHER', 'Un secondo problema con lo stesso ordine di fiori.')
  $q$);
  INSERT INTO esiti VALUES (
    'il cliente apre un reclamo dal sito come prima',
    come = 'PASSATO', format('esito: %s', come));
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ⑥ IL DEBITO RESTA ANCHE SE IL CLIENTE SE NE VA.
--
-- Il caso del collaudo: Marco ha un bonifico da 24 € ancora da ricevere e
-- cancella l'account. `disputes.opener_id` cancella a cascata, quindi il suo
-- reclamo sparisce. Con la prima versione della 162 spariva anche la riga del
-- bonifico, e chi paga non lo vedeva piu'.
-- =============================================================================
SET LOCAL ROLE service_role;
INSERT INTO public.disputes (id, order_id, opener_id, against_id, reason, description, status, refund_cents)
VALUES ('ee000000-2222-0000-0000-00000000000e',
        'ee000000-1111-0000-0000-00000000000c',
        'ee000000-0000-0000-0000-00000000000b',
        'ee000000-0000-0000-0000-00000000000a',
        'NOT_AS_DESCRIBED', 'Il vaso era diverso da quello della foto.', 'resolved_buyer', 2400);
INSERT INTO public.bonifici_dei_reclami (dispute_id, order_id, importo_cents)
VALUES ('ee000000-2222-0000-0000-00000000000e', 'ee000000-1111-0000-0000-00000000000c', 2400);
RESET ROLE;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';
DO $$
DECLARE cancellato text; reclami int; da_fare int; utenti int;
BEGIN
  cancellato := pg_temp.esito($q$
    DELETE FROM auth.users WHERE id = 'ee000000-0000-0000-0000-00000000000b'
  $q$);
  SELECT count(*) INTO utenti FROM auth.users WHERE id = 'ee000000-0000-0000-0000-00000000000b';
  SELECT count(*) INTO reclami FROM public.disputes WHERE id = 'ee000000-2222-0000-0000-00000000000e';
  SELECT count(*) INTO da_fare FROM public.bonifici_dei_reclami
   WHERE dispute_id = 'ee000000-2222-0000-0000-00000000000e' AND fatto_at IS NULL AND importo_cents = 2400;
  INSERT INTO esiti VALUES (
    'il bonifico dovuto resta in lista anche se il cliente cancella l account',
    cancellato = 'PASSATO' AND utenti = 0 AND da_fare = 1,
    format('cancellazione %s, utente rimasto %s, reclamo rimasto %s, bonifici da fare rimasti %s',
           cancellato, utenti, reclami, da_fare)
  );
END $$;
RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

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
    RAISE EXCEPTION E'% controllo/i rosso/i sui bonifici dei reclami:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'i bonifici dei reclami li tocca solo il server: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
