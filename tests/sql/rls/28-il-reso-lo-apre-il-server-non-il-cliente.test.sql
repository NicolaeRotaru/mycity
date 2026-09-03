-- =============================================================================
-- Il reso lo apre il server, non il cliente
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE.
--
-- 3/9/2026 — UN CLIENTE SI RIMBORSAVA DA SOLO UN ORDINE CONSEGNATO.
--
-- La regola di inserimento sui resi, nata con la 024, chiedeva una cosa sola:
-- «il compratore sei tu». Stato, importo del rimborso e venditore restavano
-- liberi, e `returns.seller_id` punta agli utenti, non ai negozi approvati:
-- quindi il cliente si scriveva un reso con stato «merce ricevuta», venditore
-- = se stesso, importo = il totale dell'ordine. Poi chiamava la rotta che fa
-- avanzare il reso, che riconosceva «il negozio» leggendo proprio quel campo, e
-- i quarantadue euro tornavano indietro con la merce rimasta a casa. Il fornaio
-- non ha mai visto arrivare una richiesta, e il termine dei quattordici giorni
-- del recesso era saltato da un pezzo.
--
-- COSA CONTROLLA. Apre davvero la sessione di un cliente e prova a fare il
-- danno, in tre varianti; e poi controlla che la strada onesta — il server che
-- apre un reso richiesto per conto del cliente — passi ancora. Un paletto che
-- blocca anche il lavoro pulito e' peggio del buco.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- ------------------------------------------------------------------ personaggi
-- Il fornaio, la cliente, e un secondo negozio che col reso non c'entra niente.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('cc000000-0000-0000-0000-00000000000a', 'fornaio@test.it', '{"role":"seller"}'),
  ('cc000000-0000-0000-0000-00000000000b', 'anna@test.it',    '{"role":"buyer"}'),
  ('cc000000-0000-0000-0000-00000000000c', 'fiori@test.it',   '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'cc000000-0000-0000-0000-00000000000a';

-- Un ordine da 42 euro, consegnato quaranta giorni fa: fuori dal recesso.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, delivered_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'cc000000-1111-0000-0000-00000000000d',
  'cc000000-0000-0000-0000-00000000000b',
  'cc000000-0000-0000-0000-00000000000a',
  42.00, 4200, 'card', 'PAID', 'DELIVERED', now() - interval '40 days',
  'Anna Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- Aiuto: esegue un comando e dice com'e' finito. 'PASSATO' vuol dire che il
-- database non l'ha fermato — cioe' il difetto c'e'.
CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;

-- =============================================================================
-- ① IL CASO CHE FACEVA USCIRE I SOLDI
--    La cliente scrive il reso gia' «ricevuto», con se stessa come negozio e
--    quarantadue euro di rimborso.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    INSERT INTO public.returns (order_id, buyer_id, seller_id, reason, status, refund_amount_cents)
    VALUES ('cc000000-1111-0000-0000-00000000000d',
            'cc000000-0000-0000-0000-00000000000b',
            'cc000000-0000-0000-0000-00000000000b',
            'DAMAGED', 'RECEIVED', 4200)
  $q$);
  INSERT INTO esiti VALUES (
    'la cliente non si scrive il reso gia ricevuto con se stessa come negozio',
    come <> 'PASSATO',
    CASE WHEN come = 'PASSATO'
         THEN 'PASSATO: quarantadue euro pronti a uscire senza che il fornaio sappia niente'
         ELSE 'respinto (' || come || ')' END
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ② LA VARIANTE PRUDENTE — stessa scrittura ma col negozio giusto e lo stato
--    giusto. Deve essere respinta lo stesso: i resi li apre il server, che e'
--    l'unico posto dove vivono i quattordici giorni e il controllo sull'ordine.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    INSERT INTO public.returns (order_id, buyer_id, seller_id, reason, status)
    VALUES ('cc000000-1111-0000-0000-00000000000d',
            'cc000000-0000-0000-0000-00000000000b',
            'cc000000-0000-0000-0000-00000000000a',
            'CHANGED_MIND', 'REQUESTED')
  $q$);
  INSERT INTO esiti VALUES (
    'nemmeno un reso scritto per bene entra dalla porta del cliente',
    come <> 'PASSATO',
    CASE WHEN come = 'PASSATO'
         THEN 'PASSATO: il termine dei quattordici giorni si salta scrivendo a mano'
         ELSE 'respinto (' || come || ')' END
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ③ LA STRADA ONESTA NON SI ROMPE
--    Il server (chiave di servizio) apre il reso richiesto per conto di Anna.
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE come text; quanti int;
BEGIN
  come := pg_temp.esito($q$
    INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status)
    VALUES ('cc000000-2222-0000-0000-00000000000e',
            'cc000000-1111-0000-0000-00000000000d',
            'cc000000-0000-0000-0000-00000000000b',
            'cc000000-0000-0000-0000-00000000000a',
            'DAMAGED', 'REQUESTED')
  $q$);
  SELECT count(*) INTO quanti FROM public.returns
   WHERE id = 'cc000000-2222-0000-0000-00000000000e';
  INSERT INTO esiti VALUES (
    'il server apre il reso richiesto senza intoppi',
    come = 'PASSATO' AND quanti = 1,
    format('esito %s, righe scritte %s (attesa 1)', come, quanti)
  );
END $$;
RESET ROLE;

-- =============================================================================
-- ④ IL FATTO VALE PER TUTTI — nemmeno il server puo' scrivere un reso che
--    nomina un negozio diverso da quello dell'ordine.
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    INSERT INTO public.returns (order_id, buyer_id, seller_id, reason, status)
    VALUES ('cc000000-1111-0000-0000-00000000000d',
            'cc000000-0000-0000-0000-00000000000b',
            'cc000000-0000-0000-0000-00000000000c',
            'DAMAGED', 'REQUESTED')
  $q$);
  INSERT INTO esiti VALUES (
    'il negozio del reso e quello dell ordine, per chiunque scriva',
    come <> 'PASSATO',
    CASE WHEN come = 'PASSATO'
         THEN 'PASSATO: il reso del fornaio risulta intestato al fioraio'
         ELSE 'respinto (' || come || ')' END
  );
END $$;
RESET ROLE;

-- =============================================================================
-- ⑤ LE TAPPE SI SALGONO UNA ALLA VOLTA — un reso non nasce gia' ricevuto,
--    nemmeno scritto dal server.
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    INSERT INTO public.returns (order_id, buyer_id, seller_id, reason, status, refund_amount_cents)
    VALUES ('cc000000-1111-0000-0000-00000000000d',
            'cc000000-0000-0000-0000-00000000000b',
            'cc000000-0000-0000-0000-00000000000a',
            'DAMAGED', 'RECEIVED', 4200)
  $q$);
  INSERT INTO esiti VALUES (
    'un reso nasce richiesto, non gia ricevuto',
    come <> 'PASSATO',
    CASE WHEN come = 'PASSATO'
         THEN 'PASSATO: si apre un reso gia a un passo dal rimborso'
         ELSE 'respinto (' || come || ')' END
  );
END $$;
RESET ROLE;

-- =============================================================================
-- ⑥ LA CLIENTE NON FA SALIRE IL RESO DA SOLA
--    Il reso aperto dal server esiste: Anna prova a portarlo a «ricevuto».
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text; stato text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'RECEIVED', refund_amount_cents = 4200
     WHERE id = 'cc000000-2222-0000-0000-00000000000e'
  $q$);
  RESET ROLE;
  SELECT r.status INTO stato FROM public.returns r
   WHERE r.id = 'cc000000-2222-0000-0000-00000000000e';
  INSERT INTO esiti VALUES (
    'la cliente non porta il proprio reso a merce ricevuta',
    stato = 'REQUESTED',
    format('stato del reso: %s (atteso REQUESTED), esito della scrittura: %s', stato, come)
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ⑦ QUELLO CHE NON SI DEVE ROMPERE — la cliente continua a vedere i suoi resi
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cc000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.returns
   WHERE buyer_id = 'cc000000-0000-0000-0000-00000000000b';
  INSERT INTO esiti VALUES (
    'la cliente vede ancora i propri resi',
    n = 1,
    format('resi visibili: %s (atteso 1)', n)
  );
END $$;
RESET request.jwt.claims;
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
    RAISE EXCEPTION E'% controllo/i rosso/i sui resi:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il reso lo apre il server: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
