-- =============================================================================
-- R17-003 — Il cliente dice di aver rispedito la merce, e il recesso non si chiude più senza rimborso (migrazione 411)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   psql -X -v ON_ERROR_STOP=1 -d mycity_test -f tests/sql/rls/riparazione-r17-recesso-merce-spedita.test.sql
--
-- Maria chiede il recesso (CHANGED_MIND) a Pane Quotidiano, il negozio lo
-- approva, Maria spedisce il pacco. Si controlla che:
--   ① un recesso con la merce in viaggio (SHIPPED_BACK) o già in negozio
--      (RECEIVED) non si chiuda senza rimborso (CANCELED), nemmeno scrivendo
--      con la chiave di servizio: è il «Chiudi senza rimborso» del difetto;
--   ② restino aperte le strade oneste: un reso che non è un recesso si chiude
--      anche in viaggio, un recesso approvato e mai spedito si chiude (i 14
--      giorni li conta la rotta);
--   ③ né Maria né il negozio scrivano la riga del reso da soli (153);
--   ④ la spedizione dichiarata da Maria si scriva nel passo APPROVED →
--      SHIPPED_BACK, poi non cambi, non nasca su altri passi, e la leggano lei
--      e il negozio;
--   ⑤ con la spedizione dichiarata il recesso non si chiuda senza rimborso.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1730000-0000-0000-0000-000000000001', 'forno-r17-003@test.it', '{"role":"seller"}'),
  ('e1730000-0000-0000-0000-000000000002', 'maria-r17-003@test.it', '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'e1730000-0000-0000-0000-000000000001';

-- Sei ordini da 30 €, consegnati 3 giorni fa: un reso aperto per ordine (indice della 186).
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e1730000-0000-0000-0000-000000000002', 'e1730000-0000-0000-0000-000000000001',
       30, 3000, 'card', 'PAID', 'DELIVERED', now() - interval '3 days',
       'Maria', '333', 'Via A 1', 'Piacenza', '29121'
  FROM (VALUES
    ('e1730000-0000-0000-0000-0000000000a1'),
    ('e1730000-0000-0000-0000-0000000000a2'),
    ('e1730000-0000-0000-0000-0000000000a3'),
    ('e1730000-0000-0000-0000-0000000000a4'),
    ('e1730000-0000-0000-0000-0000000000a5'),
    ('e1730000-0000-0000-0000-0000000000a6')
  ) AS v(id);

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- I resi li apre il server, in REQUESTED (153), e li fa salire una tappa alla volta.
--   b1 recesso, in viaggio (segnato dal negozio)   b2 recesso, ricevuto
--   b3 prodotto danneggiato, in viaggio            b4 recesso approvato, mai spedito
--   b5 recesso approvato: Maria dichiara           b6 recesso ancora da approvare
SET LOCAL ROLE service_role;
INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status)
SELECT v.id::uuid, v.ordine::uuid, 'e1730000-0000-0000-0000-000000000002', 'e1730000-0000-0000-0000-000000000001',
       v.motivo, 'REQUESTED'
  FROM (VALUES
    ('e1730000-0000-0000-0000-0000000000b1', 'e1730000-0000-0000-0000-0000000000a1', 'CHANGED_MIND'),
    ('e1730000-0000-0000-0000-0000000000b2', 'e1730000-0000-0000-0000-0000000000a2', 'CHANGED_MIND'),
    ('e1730000-0000-0000-0000-0000000000b3', 'e1730000-0000-0000-0000-0000000000a3', 'DAMAGED'),
    ('e1730000-0000-0000-0000-0000000000b4', 'e1730000-0000-0000-0000-0000000000a4', 'CHANGED_MIND'),
    ('e1730000-0000-0000-0000-0000000000b5', 'e1730000-0000-0000-0000-0000000000a5', 'CHANGED_MIND'),
    ('e1730000-0000-0000-0000-0000000000b6', 'e1730000-0000-0000-0000-0000000000a6', 'CHANGED_MIND')
  ) AS v(id, ordine, motivo);

UPDATE public.returns SET status = 'APPROVED', decided_at = now() - interval '20 days'
 WHERE id IN ('e1730000-0000-0000-0000-0000000000b1', 'e1730000-0000-0000-0000-0000000000b2',
              'e1730000-0000-0000-0000-0000000000b3', 'e1730000-0000-0000-0000-0000000000b4',
              'e1730000-0000-0000-0000-0000000000b5');
UPDATE public.returns SET status = 'SHIPPED_BACK'
 WHERE id IN ('e1730000-0000-0000-0000-0000000000b1', 'e1730000-0000-0000-0000-0000000000b2',
              'e1730000-0000-0000-0000-0000000000b3');
UPDATE public.returns SET status = 'RECEIVED' WHERE id = 'e1730000-0000-0000-0000-0000000000b2';
RESET ROLE;

-- Aiuti. `esito` esegue un comando e dice com'è finito: 'PASSATO' vuol dire che
-- il database non l'ha fermato, altrimenti il codice dell'errore. `leggi`
-- restituisce il valore letto, o il codice dell'errore. Solo codici, mai il
-- testo dell'errore.
CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.leggi(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN coalesce(v, '(vuoto)');
EXCEPTION WHEN others THEN
  RETURN 'errore ' || SQLSTATE;
END $$;

GRANT EXECUTE ON FUNCTION pg_temp.esito(text), pg_temp.leggi(text) TO anon, authenticated, service_role;

-- =============================================================================
-- ① Il recesso con la merce in viaggio o in negozio non si chiude senza rimborso
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE come text; stato text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'CANCELED' WHERE id = 'e1730000-0000-0000-0000-0000000000b1'
  $q$);
  SELECT r.status INTO stato FROM public.returns r WHERE r.id = 'e1730000-0000-0000-0000-0000000000b1';
  INSERT INTO esiti VALUES (
    '1a recesso in viaggio: non si chiude senza rimborso',
    come = '23514' AND stato = 'SHIPPED_BACK',
    format('esito %s, stato %s (attesi 23514 e SHIPPED_BACK): %s', come, stato,
           CASE WHEN come = 'PASSATO' THEN 'il pacco è partito e il recesso si chiude senza soldi' ELSE '' END));

  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'CANCELED' WHERE id = 'e1730000-0000-0000-0000-0000000000b2'
  $q$);
  SELECT r.status INTO stato FROM public.returns r WHERE r.id = 'e1730000-0000-0000-0000-0000000000b2';
  INSERT INTO esiti VALUES (
    '1b recesso con la merce in negozio: non si chiude senza rimborso',
    come = '23514' AND stato = 'RECEIVED',
    format('esito %s, stato %s (attesi 23514 e RECEIVED)', come, stato));

  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'REJECTED' WHERE id = 'e1730000-0000-0000-0000-0000000000b1'
  $q$);
  INSERT INTO esiti VALUES (
    '1c recesso in viaggio: non si rifiuta',
    come = '23514',
    format('esito %s (atteso 23514)', come));
END $$;
RESET ROLE;

-- =============================================================================
-- ② Le strade oneste restano aperte
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'CANCELED' WHERE id = 'e1730000-0000-0000-0000-0000000000b3'
  $q$);
  INSERT INTO esiti VALUES (
    '2a un reso che non è un recesso si chiude anche in viaggio',
    come = 'PASSATO',
    format('esito %s (atteso PASSATO)', come));

  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'CANCELED' WHERE id = 'e1730000-0000-0000-0000-0000000000b4'
  $q$);
  INSERT INTO esiti VALUES (
    '2b recesso approvato e mai spedito: il database non lo ferma (i 14 giorni li conta la rotta)',
    come = 'PASSATO',
    format('esito %s (atteso PASSATO)', come));
END $$;
RESET ROLE;

-- =============================================================================
-- ③ Né Maria né il negozio scrivono la riga del reso da soli
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1730000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'SHIPPED_BACK' WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES ('3a la cliente non scrive da sola il proprio reso', come = '42501',
    format('esito %s (atteso 42501, permesso negato)', come));
END $$;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1730000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'CANCELED' WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES ('3b il negozio non scrive da solo la riga del reso', come = '42501',
    format('esito %s (atteso 42501, permesso negato)', come));
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ④ La spedizione dichiarata da Maria: un passo solo, poi resta
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE come text; letto text;
BEGIN
  -- La rotta, per il cliente dell'ordine: APPROVED → SHIPPED_BACK, col giorno e il numero.
  come := pg_temp.esito($q$
    UPDATE public.returns
       SET status = 'SHIPPED_BACK', customer_shipped_back_on = current_date - 1, tracking_number = 'RR123456789IT'
     WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  letto := pg_temp.leggi($q$
    SELECT status || ' ' || customer_shipped_back_on::text || ' ' || tracking_number
      FROM public.returns WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES (
    '4a la spedizione dichiarata si scrive nel passo APPROVED -> SHIPPED_BACK',
    come = 'PASSATO' AND letto = 'SHIPPED_BACK ' || (current_date - 1)::text || ' RR123456789IT',
    format('esito %s, riga «%s»', come, letto));

  come := pg_temp.esito($q$
    UPDATE public.returns SET customer_shipped_back_on = current_date WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES ('4b il giorno dichiarato non si cambia', come = '23514',
    format('esito %s (atteso 23514)', come));

  come := pg_temp.esito($q$
    UPDATE public.returns SET customer_shipped_back_on = NULL WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES ('4c il giorno dichiarato non si cancella', come = '23514',
    format('esito %s (atteso 23514)', come));

  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'APPROVED', customer_shipped_back_on = current_date
     WHERE id = 'e1730000-0000-0000-0000-0000000000b6'
  $q$);
  INSERT INTO esiti VALUES ('4d la spedizione non si dichiara approvando', come = '23514',
    format('esito %s (atteso 23514)', come));

  come := pg_temp.esito($q$
    UPDATE public.returns SET customer_shipped_back_on = current_date WHERE id = 'e1730000-0000-0000-0000-0000000000b2'
  $q$);
  INSERT INTO esiti VALUES ('4e la spedizione non si dichiara su un reso già ricevuto', come = '23514',
    format('esito %s (atteso 23514)', come));
END $$;
RESET ROLE;

-- Maria e il negozio la leggono, con le regole di lettura di sempre.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1730000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE letto text;
BEGIN
  letto := pg_temp.leggi($q$
    SELECT customer_shipped_back_on::text FROM public.returns WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES ('4f la cliente legge il giorno che ha dichiarato', letto = (current_date - 1)::text,
    format('letto «%s»', letto));
END $$;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1730000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
DECLARE letto text;
BEGIN
  letto := pg_temp.leggi($q$
    SELECT customer_shipped_back_on::text || ' ' || tracking_number
      FROM public.returns WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES ('4g il negozio legge la spedizione dichiarata dalla cliente',
    letto = (current_date - 1)::text || ' RR123456789IT',
    format('letto «%s»', letto));
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ⑤ Con la spedizione dichiarata il recesso non si chiude senza rimborso
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE come text; letto text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'CANCELED' WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES ('5a spedizione dichiarata: il recesso non si chiude senza rimborso', come = '23514',
    format('esito %s (atteso 23514)', come));

  come := pg_temp.esito($q$
    UPDATE public.returns SET status = 'RECEIVED' WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  letto := pg_temp.leggi($q$
    SELECT customer_shipped_back_on::text FROM public.returns WHERE id = 'e1730000-0000-0000-0000-0000000000b5'
  $q$);
  INSERT INTO esiti VALUES ('5b spedizione dichiarata: il negozio la segna ricevuta, il giorno resta',
    come = 'PASSATO' AND letto = (current_date - 1)::text,
    format('esito %s (atteso PASSATO), giorno «%s»', come, letto));
END $$;
RESET ROLE;

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
    RAISE EXCEPTION 'R17-003: % controllo/i rosso/i sul recesso con la merce spedita', rossi;
  END IF;
  RAISE INFO 'R17-003: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
