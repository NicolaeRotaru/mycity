-- =============================================================================
-- R17-002 — Il database sa scrivere «bonifico fatto a mano» (migrazione 410)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   psql -X -v ON_ERROR_STOP=1 -d mycity_test -f tests/sql/rls/riparazione-r17-lo-stato-del-bonifico-a-mano.test.sql
--
-- Il titolo del difetto: «il bonifico del lunedì al negozio non si può segnare». Prima
-- della 410 il vincolo di payout_status non conosceva nessuno stato per il bonifico a
-- mano: un contante versato da Nicola restava HELD («in attesa») per sempre, e
-- qualunque scrittura che lo segnasse pagato era rifiutata dal database.
--
-- Qui si guarda solo questo: lo stato PAID_MANUALLY si scrive su un ordine in contanti
-- HELD, e il vincolo c'è ancora (uno stato inventato si rifiuta). La funzione che lo
-- scrive, coi suoi cancelli e la cifra versata, la prova
-- tests/sql/rls/riparazione-r17-bonifico-del-lunedi.test.sql.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1710000-0000-0000-0000-000000000001', 'forno-r17s@test.it',   '{"role":"seller"}'),
  ('e1710000-0000-0000-0000-000000000003', 'cliente-r17s@test.it', '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e1710000-0000-0000-0000-000000000001', 'e1710000-0000-0000-0000-000000000003');

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e1710000-0000-0000-0000-0000000000a1', 'e1710000-0000-0000-0000-000000000003', 'e1710000-0000-0000-0000-000000000001',
   20, 2000, 'cod', 'PAID', 'DELIVERED', now() - interval '3 days', false, 'HELD', 1800, 'Maria', '333', 'Via A 1', 'Piacenza', '29121');

-- Una scrittura dello stato del bonifico, come la fa il database per conto dell'amministratore.
CREATE FUNCTION pg_temp.scrivi(p_stato text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.orders SET payout_status = p_stato, payout_at = now()
   WHERE id = 'e1710000-0000-0000-0000-0000000000a1';
  RETURN 'scritto';
EXCEPTION WHEN check_violation THEN
  RETURN 'rifiutato dal vincolo';
END $$;

-- La scrittura in un'istruzione sua: il controllo dopo deve vedere la riga com'è diventata.
CREATE TEMP TABLE scrittura ON COMMIT DROP AS SELECT pg_temp.scrivi('PAID_MANUALLY') AS e;
INSERT INTO esiti
SELECT 'il bonifico fatto a mano si scrive: PAID_MANUALLY su un contante HELD', s.e = 'scritto' AND o.payout_status = 'PAID_MANUALLY',
       s.e || ' · ' || o.payout_status
  FROM scrittura s, public.orders o WHERE o.id = 'e1710000-0000-0000-0000-0000000000a1';

INSERT INTO esiti
SELECT 'il vincolo c è ancora: uno stato inventato si rifiuta', e = 'rifiutato dal vincolo', e
  FROM (SELECT pg_temp.scrivi('PAGATO_FORSE') AS e) t;

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
  IF (SELECT count(*) FROM esiti) < 2 THEN
    RAISE EXCEPTION 'controlli mancanti: % su 2', (SELECT count(*) FROM esiti);
  END IF;
END $$;

ROLLBACK;
