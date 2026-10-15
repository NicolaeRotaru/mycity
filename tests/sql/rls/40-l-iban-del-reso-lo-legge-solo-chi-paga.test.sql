-- =============================================================================
-- L'IBAN del reso lo legge solo chi paga
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- 11/10/2026 (R71) — Chi paga in contanti e restituisce un prodotto adesso
-- sceglie come riavere i soldi: bonifico (con l'IBAN) o credito MyCity. La
-- scelta e l'IBAN stanno sul reso (migrazione 162). Ma la regola di lettura
-- dei resi fa vedere al negozio la riga INTERA: senza la 162 il negozio
-- leggeva anche il conto del cliente, che a lui non serve — il bonifico lo fa
-- MyCity.
--
-- COSA CONTROLLA. Apre la sessione del negozio e prova a leggere l'IBAN; poi
-- controlla che la pagina del negozio continui a funzionare (le altre colonne
-- si leggono), che il server l'IBAN lo legga, e che le colonne nuove non
-- accettino cose false: un modo che non esiste, un IBAN col credito, un IBAN
-- scritto storto.
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
  ('dd000000-0000-0000-0000-00000000000a', 'maglie@test.it', '{"role":"seller"}'),
  ('dd000000-0000-0000-0000-00000000000b', 'giulia@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Maglieria del Centro'
 WHERE id = 'dd000000-0000-0000-0000-00000000000a';

-- Un maglione da 40 euro pagato in contanti al fattorino, consegnato ieri.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, delivered_at, cash_confirmed_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'dd000000-1111-0000-0000-00000000000c',
  'dd000000-0000-0000-0000-00000000000b',
  'dd000000-0000-0000-0000-00000000000a',
  40.00, 4000, 'cod', 'PAID', 'DELIVERED', now() - interval '1 day', now() - interval '1 day',
  'Giulia Bianchi', '3331234567', 'Via Roma 1', 'Piacenza', '29121'
);

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- Il server apre il reso, con la scelta del bonifico e l'IBAN di Giulia.
SET LOCAL ROLE service_role;
INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, refund_method, refund_iban)
VALUES ('dd000000-2222-0000-0000-00000000000d',
        'dd000000-1111-0000-0000-00000000000c',
        'dd000000-0000-0000-0000-00000000000b',
        'dd000000-0000-0000-0000-00000000000a',
        'CHANGED_MIND', 'REQUESTED', 'BONIFICO', 'IT60X0542811101000000123456');
RESET ROLE;

-- Aiuto: esegue un comando e dice com'e' finito. 'PASSATO' vuol dire che il
-- database non l'ha fermato.
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
-- ① IL CASO CHE ESPONEVA IL CONTO — il negozio legge l'IBAN della cliente.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    SELECT refund_iban FROM public.returns WHERE id = 'dd000000-2222-0000-0000-00000000000d'
  $q$);
  INSERT INTO esiti VALUES (
    'il negozio non legge l IBAN della cliente',
    come <> 'PASSATO',
    CASE WHEN come = 'PASSATO'
         THEN 'PASSATO: il conto della cliente e'' in chiaro nel pannello del negozio'
         ELSE 'respinto (' || come || ')' END
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ② QUELLO CHE NON SI DEVE ROMPERE — la pagina del negozio legge il reso
--    (le stesse colonne di app/seller/orders/[id]/page.tsx) e la scelta.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE v_stato text; v_modo text; n int;
BEGIN
  SELECT r.status, r.refund_method INTO v_stato, v_modo
    FROM public.returns r WHERE r.id = 'dd000000-2222-0000-0000-00000000000d';
  SELECT count(*) INTO n FROM (
    SELECT id, status, reason, notes, photo_urls, refund_amount_cents, decision_notes, created_at
      FROM public.returns WHERE order_id = 'dd000000-1111-0000-0000-00000000000c'
  ) t;
  INSERT INTO esiti VALUES (
    'il negozio legge ancora il reso e la scelta del rimborso',
    v_stato = 'REQUESTED' AND v_modo = 'BONIFICO' AND n = 1,
    format('stato %s, modo %s, righe %s (attesi REQUESTED, BONIFICO, 1)', v_stato, v_modo, n)
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ③ NEMMENO DAL BROWSER DELLA CLIENTE — l'IBAN non torna indietro verso il
--    browser di nessuno: chi lo deve usare e' il server. La cliente continua a
--    vedere il suo reso.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text; n int;
BEGIN
  come := pg_temp.esito($q$
    SELECT refund_iban FROM public.returns WHERE id = 'dd000000-2222-0000-0000-00000000000d'
  $q$);
  SELECT count(*) INTO n FROM public.returns WHERE buyer_id = 'dd000000-0000-0000-0000-00000000000b';
  INSERT INTO esiti VALUES (
    'la cliente vede il suo reso ma non riceve l IBAN dal database',
    come <> 'PASSATO' AND n = 1,
    format('lettura IBAN: %s, resi visibili: %s (attesi: respinta, 1)', come, n)
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ④ CHI PAGA LO LEGGE — il server, con la chiave di servizio.
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE v_iban text;
BEGIN
  SELECT r.refund_iban INTO v_iban FROM public.returns r
   WHERE r.id = 'dd000000-2222-0000-0000-00000000000d';
  INSERT INTO esiti VALUES (
    'il server legge l IBAN per fare il bonifico',
    v_iban = 'IT60X0542811101000000123456',
    format('IBAN letto: %s', coalesce(v_iban, 'niente'))
  );
END $$;
RESET ROLE;

-- =============================================================================
-- ⑤ LE COLONNE DICONO SOLO COSE VERE — anche se scrive il server.
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE c1 text; c2 text; c3 text; c4 text;
BEGIN
  c1 := pg_temp.esito($q$
    UPDATE public.returns SET refund_method = 'CONTANTI', refund_iban = NULL
     WHERE id = 'dd000000-2222-0000-0000-00000000000d'
  $q$);
  c2 := pg_temp.esito($q$
    UPDATE public.returns SET refund_method = 'CREDITO'
     WHERE id = 'dd000000-2222-0000-0000-00000000000d'
  $q$);
  c3 := pg_temp.esito($q$
    UPDATE public.returns SET refund_iban = 'it60 x054 2811'
     WHERE id = 'dd000000-2222-0000-0000-00000000000d'
  $q$);
  c4 := pg_temp.esito($q$
    UPDATE public.returns SET refund_method = 'CREDITO', refund_iban = NULL
     WHERE id = 'dd000000-2222-0000-0000-00000000000d'
  $q$);
  INSERT INTO esiti VALUES (
    'un modo di rimborso che non esiste non entra',
    c1 <> 'PASSATO', format('esito: %s', c1));
  INSERT INTO esiti VALUES (
    'un IBAN col credito non entra',
    c2 <> 'PASSATO', format('esito: %s', c2));
  INSERT INTO esiti VALUES (
    'un IBAN scritto storto non entra',
    c3 <> 'PASSATO', format('esito: %s', c3));
  INSERT INTO esiti VALUES (
    'il passaggio pulito al credito, senza IBAN, entra',
    c4 = 'PASSATO', format('esito: %s', c4));
END $$;
RESET ROLE;

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
    RAISE EXCEPTION E'% controllo/i rosso/i sull IBAN dei resi:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'l IBAN del reso lo legge solo chi paga: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
