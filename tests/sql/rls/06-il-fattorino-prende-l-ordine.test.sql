-- =============================================================================
-- Il fattorino riesce a PRENDERE un ordine libero (migrazione 123)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- La 122 ha chiuso la falla dei recapiti stringendo la lettura di `orders` a
-- «solo gli ordini che sono miei». Effetto non previsto: la presa dell'ordine
-- e' un `UPDATE ... WHERE rider_id IS NULL`, e in PostgreSQL il WHERE di un
-- UPDATE passa anche dalle policy di SELECT. Su un ordine libero quella riga
-- non e' visibile, quindi l'UPDATE aggiornava zero righe: il fattorino vedeva
-- l'ordine sulla bacheca e non poteva prenderlo.
--
-- Qui si prova tutto il giro, coi permessi veri del fattorino:
--   ① la bacheca gli mostra l'ordine libero
--   ② l'UPDATE diretto NON funziona piu' — e' il difetto, va conservato
--   ③ prendi_ordine() funziona e l'ordine diventa suo
--   ④ un secondo fattorino che arriva dopo non se lo porta via
--   ⑤ chi non e' un fattorino approvato non puo' prendere niente
--
-- Senza la 123 il passo ③ fallisce. Tutto in una transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it',     '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'fattorino@test.it',   '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',     '{"role":"buyer"}'),
  ('44444444-4444-4444-4444-444444444444', 'fattorino2@test.it',  '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444');

-- Un ordine libero e pronto, con i dati di casa del cliente.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip,
  rider_fee_cents
) VALUES (
  'a0000000-0000-0000-0000-00000000000a',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  42.00, 'PAID', 'READY',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121',
  450
);

-- ---------------------------------------------------------------------------
-- ① La bacheca gli mostra l'ordine libero.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

INSERT INTO esiti
SELECT 'la bacheca mostra l''ordine libero',
       count(*) = 1,
       'righe in bacheca: ' || count(*)
  FROM public.ordini_disponibili_rider;

-- ---------------------------------------------------------------------------
-- ② L'UPDATE diretto non trova la riga: e' il difetto che la 123 aggira.
--    Se un giorno tornasse a funzionare, vuol dire che la lettura si e'
--    riallargata — cioe' che la falla dei recapiti e' tornata.
-- ---------------------------------------------------------------------------
WITH tentativo AS (
  UPDATE public.orders
     SET rider_id = '22222222-2222-2222-2222-222222222222', delivery_status = 'ASSIGNED'
   WHERE id = 'a0000000-0000-0000-0000-00000000000a'
     AND rider_id IS NULL
     AND delivery_status = 'READY'
  RETURNING id
)
INSERT INTO esiti
SELECT 'l''UPDATE diretto non vede la riga (la lettura resta stretta)',
       count(*) = 0,
       'righe aggiornate: ' || count(*)
  FROM tentativo;

-- ---------------------------------------------------------------------------
-- ③ La funzione fidata invece prende l'ordine.
-- ---------------------------------------------------------------------------
INSERT INTO esiti
SELECT 'prendi_ordine() assegna l''ordine al fattorino',
       (r ->> 'ok')::boolean IS TRUE
         AND (r ->> 'id') = 'a0000000-0000-0000-0000-00000000000a',
       'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0000000-0000-0000-0000-00000000000a') AS r) t;

INSERT INTO esiti
SELECT 'ora l''ordine e'' suo e ne legge i recapiti',
       count(*) = 1,
       'ordini suoi visibili: ' || count(*)
  FROM public.orders
 WHERE rider_id = '22222222-2222-2222-2222-222222222222'
   AND delivery_phone = '3331234567';

-- ---------------------------------------------------------------------------
-- ④ Il secondo fattorino arriva tardi e non se lo porta via.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

INSERT INTO esiti
SELECT 'il secondo fattorino non ruba l''ordine gia'' preso',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'GIA_PRESO',
       'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0000000-0000-0000-0000-00000000000a') AS r) t;

-- ---------------------------------------------------------------------------
-- ⑤ Chi non e' un fattorino approvato non prende niente.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

INSERT INTO esiti
SELECT 'un cliente qualunque non puo'' prendere ordini',
       (r ->> 'ok')::boolean IS FALSE AND (r ->> 'motivo') = 'NON_FATTORINO',
       'risposta: ' || r::text
  FROM (SELECT public.prendi_ordine('a0000000-0000-0000-0000-00000000000a') AS r) t;

-- ---------------------------------------------------------------------------
RESET ROLE;

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM esiti WHERE NOT ok;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli falliti sulla presa dell''ordine', n;
  END IF;
END $$;

ROLLBACK;
