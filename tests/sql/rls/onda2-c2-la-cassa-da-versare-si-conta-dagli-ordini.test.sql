-- =============================================================================
-- onda2 C2 (R08-004, R08-005, R08-006) — La cassa da versare del fattorino si conta dagli ordini
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   psql -d mycity_test -f tests/sql/rls/onda2-c2-la-cassa-da-versare-si-conta-dagli-ordini.test.sql
--
-- La guardia della cancellazione (lib/account/cancellazione.ts) chiede al database quanti
-- contanti dei negozi ha ancora in tasca un fattorino (`cassa_da_versare_del_fattorino`,
-- migrazione 999n). Prima leggeva solo la riga del giorno in `cod_reconciliations`:
--  · fattorino 1: versa alle 15, alle 18 incassa ancora. La riga ha remitted_at pieno: per il
--    registro non deve niente e l'account si cancellava coi 37 € delle 18 in tasca (R08-006);
--  · fattorino 2: giornata riaperta (remitted_at svuotato). Il registro diceva «55 € non
--    versati», 40 dei quali versati da ore (R08-004, R08-005);
--  · fattorino 3: un rimborsato coi contanti ancora in mano conta, uno già rientrato no (R29-011);
--  · fattorino 4: una giornata che il registro dice in ammanco ferma la cancellazione come prima;
--  · fattorino 5: tutto versato, niente da chiedere;
--  · fattorino 6 (N-003, onda 3): ha incassato 28 € alla porta e la consegna è ancora in strada
--    (OUT_FOR_DELIVERY, `cash_confirmed_at` scritto). Si contavano solo i consegnati: per la guardia
--    non aveva niente in tasca e l'account si cancellava. Il secondo ordine in strada, senza incasso
--    dichiarato, non conta: quei contanti non li ha ancora.
-- Senza la migrazione la funzione non esiste e la prova è ROSSA.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c2c20000-0000-0000-0000-000000000001', 'fornaio-c2@test.it',     '{"role":"seller"}'),
  ('c2c20000-0000-0000-0000-000000000002', 'cliente-c2@test.it',     '{"role":"buyer"}'),
  ('c2c20000-0000-0000-0000-000000000011', 'fattorino1-c2@test.it',  '{"role":"rider"}'),
  ('c2c20000-0000-0000-0000-000000000012', 'fattorino2-c2@test.it',  '{"role":"rider"}'),
  ('c2c20000-0000-0000-0000-000000000013', 'fattorino3-c2@test.it',  '{"role":"rider"}'),
  ('c2c20000-0000-0000-0000-000000000014', 'fattorino4-c2@test.it',  '{"role":"rider"}'),
  ('c2c20000-0000-0000-0000-000000000015', 'fattorino5-c2@test.it',  '{"role":"rider"}'),
  ('c2c20000-0000-0000-0000-000000000016', 'fattorino6-c2@test.it',  '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'c2c20000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('c2c20000-0000-0000-0000-000000000002', 'c2c20000-0000-0000-0000-000000000011',
              'c2c20000-0000-0000-0000-000000000012', 'c2c20000-0000-0000-0000-000000000013',
              'c2c20000-0000-0000-0000-000000000014', 'c2c20000-0000-0000-0000-000000000015',
              'c2c20000-0000-0000-0000-000000000016');

-- Gli ordini in contanti consegnati: (id, fattorino, consegnato, incasso registrato, contanti, stato del bonifico).
-- Novembre: Roma è un'ora avanti a Greenwich, le ore qui sotto sono di Roma.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, cash_confirmed_at, cash_collected_cents, pickup_in_store, payout_status,
  seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'c2c20000-0000-0000-0000-000000000002', 'c2c20000-0000-0000-0000-000000000001', v.rider::uuid,
       v.contanti / 100.0, v.contanti, 'cod', 'PAID',
       'DELIVERED', v.consegnato::timestamptz, v.incassato::timestamptz, v.contanti, false, v.stato,
       v.contanti - 300, 300,
       'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    -- fattorino 1: A versato alle 15, B incassato alle 18 dopo il versamento
    ('c2c20000-0000-0000-0000-0000000001a1', 'c2c20000-0000-0000-0000-000000000011', '2026-11-20 10:00+01', '2026-11-20 10:05+01', 2200, 'HELD'),
    ('c2c20000-0000-0000-0000-0000000001b1', 'c2c20000-0000-0000-0000-000000000011', '2026-11-20 18:00+01', '2026-11-20 18:05+01', 3700, 'AWAITING_REMITTANCE'),
    -- fattorino 2: C versato, E ancora in tasca, giornata riaperta
    ('c2c20000-0000-0000-0000-0000000002c1', 'c2c20000-0000-0000-0000-000000000012', '2026-11-21 10:00+01', '2026-11-21 10:05+01', 4000, 'HELD'),
    ('c2c20000-0000-0000-0000-0000000002e1', 'c2c20000-0000-0000-0000-000000000012', '2026-11-21 12:00+01', '2026-11-21 12:05+01', 1500, 'AWAITING_REMITTANCE'),
    -- fattorino 3: R rimborsato coi contanti in mano, R2 rimborsato e già rientrato
    ('c2c20000-0000-0000-0000-0000000003a1', 'c2c20000-0000-0000-0000-000000000013', '2026-11-22 10:00+01', '2026-11-22 10:05+01', 2500, 'REFUNDED'),
    ('c2c20000-0000-0000-0000-0000000003b1', 'c2c20000-0000-0000-0000-000000000013', '2026-11-23 10:00+01', '2026-11-23 10:05+01', 1800, 'REFUNDED'),
    -- fattorino 5: tutto versato
    ('c2c20000-0000-0000-0000-0000000005a1', 'c2c20000-0000-0000-0000-000000000015', '2026-11-24 10:00+01', '2026-11-24 10:05+01', 3000, 'HELD')
  ) AS v(id, rider, consegnato, incassato, contanti, stato);

-- N-003 — fattorino 6, due consegne ancora in strada: F con i 28 € già dichiarati incassati alle 19:10,
-- G senza incasso dichiarato (i contanti non li ha ancora presi).
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, cash_confirmed_at, cash_collected_cents, pickup_in_store, payout_status,
  seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'c2c20000-0000-0000-0000-000000000002', 'c2c20000-0000-0000-0000-000000000001',
       'c2c20000-0000-0000-0000-000000000016', v.contanti / 100.0, v.contanti, 'cod', v.pagamento,
       'OUT_FOR_DELIVERY', NULL, v.incassato::timestamptz, v.incassati, false, 'AWAITING_REMITTANCE',
       v.contanti - 300, 300,
       'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    ('c2c20000-0000-0000-0000-0000000006f1', 2800, 'PAID',    '2026-11-25 19:10+01', 2800),
    ('c2c20000-0000-0000-0000-0000000006a1', 1900, 'PENDING', NULL,                  NULL)
  ) AS v(id, contanti, pagamento, incassato, incassati);
SET LOCAL mycity.allow_order_write = '';

-- Il registro delle giornate, com'è dopo la quadratura (collected = tutto l'incassato del giorno).
INSERT INTO public.cod_reconciliations (rider_id, for_date, expected_cents, collected_cents, status, remitted_at) VALUES
  ('c2c20000-0000-0000-0000-000000000011', '2026-11-20', 5300, 5900, 'MISMATCH', '2026-11-20 15:00+01'),
  ('c2c20000-0000-0000-0000-000000000012', '2026-11-21', 4900, 5500, 'MISMATCH', NULL),
  ('c2c20000-0000-0000-0000-000000000013', '2026-11-23', 1500, 1800, 'MISMATCH', '2026-11-23 13:00+01'),
  ('c2c20000-0000-0000-0000-000000000014', '2026-11-24', 2700,    0, 'MISMATCH', NULL),
  ('c2c20000-0000-0000-0000-000000000015', '2026-11-24', 2700, 3000, 'MISMATCH', '2026-11-24 16:00+01');

-- La guardia la chiama col client di servizio.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  c jsonb;
  attesi jsonb := jsonb_build_object(
    'c2c20000-0000-0000-0000-000000000011', '{"centesimi":3700,"giornate":1,"ordini":1}'::jsonb,
    'c2c20000-0000-0000-0000-000000000012', '{"centesimi":1500,"giornate":1,"ordini":1}'::jsonb,
    'c2c20000-0000-0000-0000-000000000013', '{"centesimi":2500,"giornate":1,"ordini":1}'::jsonb,
    'c2c20000-0000-0000-0000-000000000014', '{"centesimi":0,"giornate":1,"ordini":0}'::jsonb,
    'c2c20000-0000-0000-0000-000000000015', '{"centesimi":0,"giornate":0,"ordini":0}'::jsonb,
    'c2c20000-0000-0000-0000-000000000016', '{"centesimi":2800,"giornate":1,"ordini":1}'::jsonb);
  nomi jsonb := jsonb_build_object(
    'c2c20000-0000-0000-0000-000000000011', 'R08-006 contanti incassati dopo il versamento dello stesso giorno: si vedono',
    'c2c20000-0000-0000-0000-000000000012', 'R08-004/005 giornata riaperta: si contano solo i contanti non versati',
    'c2c20000-0000-0000-0000-000000000013', 'rimborsato coi contanti in mano conta, quello gia rientrato no',
    'c2c20000-0000-0000-0000-000000000014', 'giornata in ammanco nel registro: ferma ancora la cancellazione',
    'c2c20000-0000-0000-0000-000000000015', 'tutto versato: niente da chiedere',
    'c2c20000-0000-0000-0000-000000000016', 'N-003 contanti dichiarati su una consegna ancora in strada: si vedono');
  chi text;
BEGIN
  IF to_regprocedure('public.cassa_da_versare_del_fattorino(uuid)') IS NULL THEN
    INSERT INTO esiti VALUES ('la funzione della cassa esiste', false, 'migrazione 999n non applicata');
    RETURN;
  END IF;
  FOR chi IN SELECT jsonb_object_keys(attesi) LOOP
    EXECUTE 'SELECT public.cassa_da_versare_del_fattorino($1)' INTO c USING chi::uuid;
    INSERT INTO esiti VALUES (nomi->>chi, c = attesi->chi, format('atteso %s, avuto %s', attesi->chi, c));
  END LOOP;
END $$;
RESET ROLE;

-- Il browser non la chiama: nemmeno il fattorino per sé.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c2c20000-0000-0000-0000-000000000011","role":"authenticated"}';
DO $$
DECLARE rifiutato boolean := false;
BEGIN
  IF to_regprocedure('public.cassa_da_versare_del_fattorino(uuid)') IS NULL THEN RETURN; END IF;
  BEGIN
    EXECUTE 'SELECT public.cassa_da_versare_del_fattorino($1)' USING 'c2c20000-0000-0000-0000-000000000011'::uuid;
  EXCEPTION WHEN insufficient_privilege THEN rifiutato := true;
  END;
  INSERT INTO esiti VALUES ('il browser non chiama la funzione della cassa', rifiutato, 'rifiutato: ' || rifiutato);
END $$;
RESET ROLE;

-- Nessun soldo toccato: la funzione legge e basta.
INSERT INTO esiti
SELECT 'gli ordini restano come erano',
       count(*) FILTER (WHERE payout_status = 'AWAITING_REMITTANCE') = 4 AND count(*) FILTER (WHERE payout_status = 'HELD') = 3,
       format('in attesa %s, rilasciati %s', count(*) FILTER (WHERE payout_status = 'AWAITING_REMITTANCE'),
              count(*) FILTER (WHERE payout_status = 'HELD'))
  FROM public.orders WHERE id::text LIKE 'c2c20000-%';

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.ok IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulla cassa da versare del fattorino:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la cassa da versare si conta dagli ordini: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
