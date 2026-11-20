-- =============================================================================
-- R05-006 — I soldi fra gli ordini del carrello passano in una transazione
--           (sposta_la_consegna_nel_carrello, migrations/620)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere (Postgres usa e getta):
--   tests/sql/harness/apply.sh mycity_test
--   psql -X -v ON_ERROR_STOP=1 -d mycity_test -f tests/sql/rls/riparazione-r05-soldi-in-transazione.test.sql
--
-- Pane 15 € + frutta 12 €, un carrello solo pagato con la carta: pane 3 € di consegna e 3 € al
-- fattorino (18 €), frutta 1 € e 1 € (13 €). Il forno rifiuta: pane 1 € e 0 (16 €), frutta 3 € e 3 €
-- (15 €). Il conto lo fa lib/ordini/annulla.ts; qui si prova che la funzione lo scrive tutto o niente:
--   ① una riga non più com'era letta (anche una solo da controllare): false, niente scritto;
--   ② un errore sulla seconda scrittura disfa anche la prima: il pane non resta a 1 €;
--   ③ righe malformate, ripetute o di clienti diversi: errore, niente scritto;
--   ④ col carrello com'era letto scrive tutto insieme, e la consegna del carrello resta 4 €;
--   ⑤ la stessa chiamata ripetuta non sposta due volte;
--   ⑥ all'indietro (il rimborso non parte) torna tutto com'era, in una chiamata;
--   ⑦ la chiama solo il server: né l'anonimo né un cliente.
-- Le chiamate girano come service_role, senza la spia mycity.allow_order_write: come da PostgREST.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e6200000-0000-0000-0000-000000000001', 'forno-r05-006@test.it',  '{"role":"seller"}'),
  ('e6200000-0000-0000-0000-000000000002', 'frutta-r05-006@test.it', '{"role":"seller"}'),
  ('e6200000-0000-0000-0000-000000000003', 'maria-r05-006@test.it',  '{"role":"buyer"}'),
  ('e6200000-0000-0000-0000-000000000004', 'luca-r05-006@test.it',   '{"role":"buyer"}');

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, refunded_amount_cents, payment_method, payment_status,
  delivery_status, delivery_fee_cents, rider_fee_cents, stripe_session_id,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e6200000-0000-0000-0000-0000000000a1', 'e6200000-0000-0000-0000-000000000003', 'e6200000-0000-0000-0000-000000000001',
   18, 1800, 0, 'card', 'PAID', 'NEW', 300, 300, 'cs_r05_006', 'Maria', '333', 'Via A 1', 'Piacenza', '29121'),
  ('e6200000-0000-0000-0000-0000000000a2', 'e6200000-0000-0000-0000-000000000003', 'e6200000-0000-0000-0000-000000000002',
   13, 1300, 0, 'card', 'PAID', 'NEW', 100, 100, 'cs_r05_006', 'Maria', '333', 'Via A 1', 'Piacenza', '29121'),
  ('e6200000-0000-0000-0000-0000000000a3', 'e6200000-0000-0000-0000-000000000004', 'e6200000-0000-0000-0000-000000000002',
   13, 1300, 0, 'card', 'PAID', 'NEW', 100, 100, 'cs_r05_006_luca', 'Luca', '334', 'Via B 2', 'Piacenza', '29121');

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- Le righe del carrello come le scrive la funzione: «pane 300/300/18.00 · frutta 100/100/13.00».
CREATE TEMP TABLE giri (nome text PRIMARY KEY, righe jsonb) ON COMMIT DROP;
GRANT ALL ON giri TO anon, authenticated, service_role;
INSERT INTO giri VALUES
  -- il forno rifiuta: tutte e due le righe, com'erano lette
  ('avanti', '[
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":100,"rider_fee_cents":0,"total_price":16,"gross_total_cents":1600}},
     {"id":"e6200000-0000-0000-0000-0000000000a2",
      "da":{"delivery_fee_cents":100,"rider_fee_cents":100,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":300,"rider_fee_cents":300,"total_price":15,"gross_total_cents":1500}}]'),
  -- la frutta letta con 90 centesimi al fattorino: non è più così
  ('frutta-cambiata', '[
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":100,"rider_fee_cents":0,"total_price":16,"gross_total_cents":1600}},
     {"id":"e6200000-0000-0000-0000-0000000000a2",
      "da":{"delivery_fee_cents":100,"rider_fee_cents":90,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":300,"rider_fee_cents":300,"total_price":15,"gross_total_cents":1500}}]'),
  -- la frutta solo da controllare, letta già accettata: non è più così
  ('controllata-cambiata', '[
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":300,"rider_fee_cents":0,"total_price":18,"gross_total_cents":1800}},
     {"id":"e6200000-0000-0000-0000-0000000000a2",
      "da":{"delivery_fee_cents":100,"rider_fee_cents":100,"delivery_status":"ACCEPTED","refunded_amount_cents":0,"incassato":false}}]'),
  -- la seconda scrittura sfonda un paletto sui soldi (fattorino oltre 50 €): la prima è già fatta
  ('seconda-rotta', '[
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":100,"rider_fee_cents":0,"total_price":16,"gross_total_cents":1600}},
     {"id":"e6200000-0000-0000-0000-0000000000a2",
      "da":{"delivery_fee_cents":100,"rider_fee_cents":100,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":300,"rider_fee_cents":6000,"total_price":15,"gross_total_cents":1500}}]'),
  ('senza-incassato', '[
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0},
      "a":{"delivery_fee_cents":100,"rider_fee_cents":0,"total_price":16,"gross_total_cents":1600}}]'),
  ('ripetuta', '[
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":100,"rider_fee_cents":0,"total_price":16,"gross_total_cents":1600}},
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":100,"rider_fee_cents":0,"total_price":16,"gross_total_cents":1600}}]'),
  -- il pane di Maria con un ordine di Luca: non è un carrello
  ('due-clienti', '[
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":100,"rider_fee_cents":0,"total_price":16,"gross_total_cents":1600}},
     {"id":"e6200000-0000-0000-0000-0000000000a3",
      "da":{"delivery_fee_cents":100,"rider_fee_cents":100,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":300,"rider_fee_cents":300,"total_price":15,"gross_total_cents":1500}}]'),
  -- il rimborso non parte: all'indietro, dalle righe scritte a com'erano
  ('indietro', '[
     {"id":"e6200000-0000-0000-0000-0000000000a1",
      "da":{"delivery_fee_cents":100,"rider_fee_cents":0,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":300,"rider_fee_cents":300,"total_price":18,"gross_total_cents":1800}},
     {"id":"e6200000-0000-0000-0000-0000000000a2",
      "da":{"delivery_fee_cents":300,"rider_fee_cents":300,"delivery_status":"NEW","refunded_amount_cents":0,"incassato":false},
      "a":{"delivery_fee_cents":100,"rider_fee_cents":100,"total_price":13,"gross_total_cents":1300}}]');

CREATE TEMP VIEW carrello AS
SELECT string_agg(
         CASE WHEN id = 'e6200000-0000-0000-0000-0000000000a1' THEN 'pane ' ELSE 'frutta ' END
           || delivery_fee_cents || '/' || rider_fee_cents || '/' || total_price::numeric(10,2) || '/' || gross_total_cents,
         ' · ' ORDER BY id) AS com_e
  FROM public.orders
 WHERE id IN ('e6200000-0000-0000-0000-0000000000a1', 'e6200000-0000-0000-0000-0000000000a2');
GRANT SELECT ON carrello TO anon, authenticated, service_role;

-- ── Il server, come da PostgREST: ruolo service_role, nessuna spia accesa ─────
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE
  com_era constant text := 'pane 300/300/18.00/1800 · frutta 100/100/13.00/1300';
  dopo    constant text := 'pane 100/0/16.00/1600 · frutta 300/300/15.00/1500';
  r boolean;
  stato text;
  codice text;
BEGIN
  -- ① una riga non più com'era letta
  r := public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'frutta-cambiata'));
  SELECT com_e INTO stato FROM carrello;
  INSERT INTO esiti VALUES ('1a la frutta cambiata: risponde false e il pane non scende a 1 €',
    r = false AND stato = com_era, format('%s · %s', r, stato));

  r := public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'controllata-cambiata'));
  SELECT com_e INTO stato FROM carrello;
  INSERT INTO esiti VALUES ('1b anche una riga solo da controllare, se è cambiata, ferma tutto',
    r = false AND stato = com_era, format('%s · %s', r, stato));

  -- ② un errore sulla seconda scrittura disfa anche la prima
  codice := 'nessun errore';
  BEGIN
    PERFORM public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'seconda-rotta'));
  EXCEPTION WHEN OTHERS THEN
    codice := SQLSTATE;
  END;
  SELECT com_e INTO stato FROM carrello;
  INSERT INTO esiti VALUES ('2a la seconda scrittura cade: errore, e il pane già scritto torna a 3 € (niente a metà)',
    codice = '23514' AND stato = com_era, format('%s · %s', codice, stato));

  -- ③ righe malformate, ripetute o di clienti diversi
  codice := 'nessun errore';
  BEGIN
    PERFORM public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'senza-incassato'));
  EXCEPTION WHEN OTHERS THEN codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('3a una riga senza tutte le chiavi di «com era letta» non passa', codice = '22023', codice);

  codice := 'nessun errore';
  BEGIN
    PERFORM public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'ripetuta'));
  EXCEPTION WHEN OTHERS THEN codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('3b la stessa riga due volte non passa', codice = '22023', codice);

  codice := 'nessun errore';
  BEGIN
    PERFORM public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'due-clienti'));
  EXCEPTION WHEN OTHERS THEN codice := SQLSTATE;
  END;
  SELECT com_e INTO stato FROM carrello;
  INSERT INTO esiti VALUES ('3c ordini di due clienti non sono un carrello: errore, niente scritto',
    codice = '22023' AND stato = com_era, format('%s · %s', codice, stato));

  -- ④ col carrello com'era letto: tutto insieme
  r := public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'avanti'));
  SELECT com_e INTO stato FROM carrello;
  INSERT INTO esiti VALUES ('4a il forno rifiuta: pane a 16 €, frutta a 3 € e 3 € (15 €), in una chiamata',
    r AND stato = dopo, format('%s · %s', r, stato));
  INSERT INTO esiti
  SELECT '4b la consegna del carrello resta 4 €: si sposta, non sparisce',
         sum(delivery_fee_cents) = 400, sum(delivery_fee_cents)::text
    FROM public.orders
   WHERE id IN ('e6200000-0000-0000-0000-0000000000a1', 'e6200000-0000-0000-0000-0000000000a2');

  -- ⑤ la stessa chiamata ripetuta (una risposta persa, un ritentativo) non sposta due volte
  r := public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'avanti'));
  SELECT com_e INTO stato FROM carrello;
  INSERT INTO esiti VALUES ('5a ripetuta: false, e il carrello resta col conto di una volta sola',
    r = false AND stato = dopo, format('%s · %s', r, stato));

  -- ⑥ il rimborso non parte: all'indietro, tutto in una chiamata
  r := public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'indietro'));
  SELECT com_e INTO stato FROM carrello;
  INSERT INTO esiti VALUES ('6a all indietro torna tutto com era',
    r AND stato = com_era, format('%s · %s', r, stato));
END $$;

RESET ROLE;

-- ── ⑦ Solo il server ─────────────────────────────────────────────────────────
INSERT INTO esiti
SELECT '7a l anonimo e il cliente non hanno il permesso di chiamarla, il server sì',
       NOT has_function_privilege('anon', 'public.sposta_la_consegna_nel_carrello(jsonb)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.sposta_la_consegna_nel_carrello(jsonb)', 'EXECUTE')
   AND has_function_privilege('service_role', 'public.sposta_la_consegna_nel_carrello(jsonb)', 'EXECUTE'),
       format('anon %s · authenticated %s · service_role %s',
              has_function_privilege('anon', 'public.sposta_la_consegna_nel_carrello(jsonb)', 'EXECUTE'),
              has_function_privilege('authenticated', 'public.sposta_la_consegna_nel_carrello(jsonb)', 'EXECUTE'),
              has_function_privilege('service_role', 'public.sposta_la_consegna_nel_carrello(jsonb)', 'EXECUTE'));

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e6200000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE codice text := 'nessun errore';
BEGIN
  BEGIN
    PERFORM public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'avanti'));
  EXCEPTION WHEN OTHERS THEN codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('7b Maria, dal browser, non sposta la consegna del suo carrello', codice = '42501', codice);
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
DO $$
DECLARE codice text := 'nessun errore';
BEGIN
  BEGIN
    PERFORM public.sposta_la_consegna_nel_carrello((SELECT righe FROM giri WHERE nome = 'avanti'));
  EXCEPTION WHEN OTHERS THEN codice := SQLSTATE;
  END;
  INSERT INTO esiti VALUES ('7c l anonimo nemmeno', codice = '42501', codice);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT '7d dopo i tentativi del browser il carrello è ancora com era',
       com_e = 'pane 300/300/18.00/1800 · frutta 100/100/13.00/1300', com_e
  FROM carrello;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE r record; rossi int := 0;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    IF r.ok THEN
      RAISE INFO 'ok  %', r.nome;
    ELSE
      rossi := rossi + 1;
      RAISE INFO 'NO  % — %', r.nome, r.dettaglio;
    END IF;
  END LOOP;
  IF rossi > 0 THEN
    RAISE EXCEPTION 'R05-006: % controllo/i rosso/i sulla transazione del carrello', rossi;
  END IF;
  RAISE INFO 'R05-006: % controlli verdi sulla transazione del carrello', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
