-- =============================================================================
-- R14-006 — La seconda conferma uguale della rimessa non e' una rimessa
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il doppio clic su «Conferma i contanti ricevuti» manda due conferme uguali:
-- stesso fattorino, stesso giorno. Col lucchetto della 381 la seconda non
-- rilascia piu' niente, ma `confirm_cod_remittance` riscriveva lo stesso il
-- «versato»: `remitted_at` col suo orario e `remitted_by` con chi aveva
-- cliccato per secondo. Il registro dei contanti diceva che li aveva ricevuti
-- l'amministratore della conferma doppia.
--
-- Il contratto: una conferma che trova la giornata gia' versata e non rilascia
-- niente non tocca chi e quando della prima. Una rimessa VERA dopo (un ordine
-- nuovo nello stesso giorno riapre la giornata, la conferma lo rilascia) scrive
-- invece il nuovo «versato», come prima.
--
-- Si passa dalla porta vera: la conferma come amministratore, col suo accesso.
-- Senza la migrazione 383 questa prova e' ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1406000-0000-0000-0000-000000000001', 'forno-r14-006@test.it',     '{"role":"seller"}'),
  ('e1406000-0000-0000-0000-000000000002', 'fattorino-r14-006@test.it', '{"role":"rider"}'),
  ('e1406000-0000-0000-0000-000000000003', 'cliente-r14-006@test.it',   '{"role":"buyer"}'),
  ('e1406000-0000-0000-0000-000000000004', 'capo1-r14-006@test.it',     '{"role":"admin"}'),
  ('e1406000-0000-0000-0000-000000000005', 'capo2-r14-006@test.it',     '{"role":"admin"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Forno di prova R14-006',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'e1406000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e1406000-0000-0000-0000-000000000002', 'e1406000-0000-0000-0000-000000000003');
UPDATE public.profiles SET role = 'admin'
 WHERE id IN ('e1406000-0000-0000-0000-000000000004', 'e1406000-0000-0000-0000-000000000005');

-- A: in contanti, consegnato adesso, incasso dichiarato. Aspetta la rimessa.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  cash_confirmed_at, cash_collected_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e1406000-0000-0000-0000-0000000000a1',
  'e1406000-0000-0000-0000-000000000003', 'e1406000-0000-0000-0000-000000000001',
  'e1406000-0000-0000-0000-000000000002',
  25.00, 2500, 'cod', 'PAID', 'DELIVERED', now(), false, 'AWAITING_REMITTANCE', 2250, 450,
  now(), 2050,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- =============================================================================
-- ① Il primo clic: l'amministratore 1 conferma, A si rilascia, giornata versata
-- =============================================================================
SET LOCAL mycity.allow_order_write = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1406000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.confirm_cod_remittance(
    'e1406000-0000-0000-0000-000000000002'::uuid, (now() AT TIME ZONE 'Europe/Rome')::date);
  INSERT INTO esiti VALUES (
    '① premessa: la prima conferma rilascia A',
    (esito->>'rilasciati')::int = 1, esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT '① premessa: la giornata risulta versata dall amministratore 1',
       c.remitted_at IS NOT NULL AND c.remitted_by = 'e1406000-0000-0000-0000-000000000004',
       format('versata alle %s da %s', coalesce(c.remitted_at::text, '—'), coalesce(c.remitted_by::text, '—'))
  FROM public.cod_reconciliations c
 WHERE c.rider_id = 'e1406000-0000-0000-0000-000000000002'
   AND c.for_date = (now() AT TIME ZONE 'Europe/Rome')::date;

-- Il «quando» della prima conferma, spostato indietro di un'ora: dentro una
-- transazione now() non cambia, e la conferma doppia lo riscriverebbe uguale.
-- Cosi' un orario riscritto si vede.
UPDATE public.cod_reconciliations
   SET remitted_at = remitted_at - interval '1 hour'
 WHERE rider_id = 'e1406000-0000-0000-0000-000000000002'
   AND for_date = (now() AT TIME ZONE 'Europe/Rome')::date;
CREATE TEMP TABLE prima_conferma ON COMMIT DROP AS
SELECT remitted_at, remitted_by FROM public.cod_reconciliations
 WHERE rider_id = 'e1406000-0000-0000-0000-000000000002'
   AND for_date = (now() AT TIME ZONE 'Europe/Rome')::date;

-- =============================================================================
-- ② Il secondo clic: la stessa conferma, arrivata dopo (qui dall'amministratore 2)
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1406000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.confirm_cod_remittance(
    'e1406000-0000-0000-0000-000000000002'::uuid, (now() AT TIME ZONE 'Europe/Rome')::date);
  INSERT INTO esiti VALUES (
    '② la seconda conferma uguale non rilascia niente',
    (esito->>'rilasciati')::int = 0, esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT '② la seconda conferma uguale lascia chi e quando della prima',
       c.remitted_at = p.remitted_at AND c.remitted_by = p.remitted_by,
       format('prima: %s da %s · adesso: %s da %s',
              p.remitted_at, p.remitted_by, coalesce(c.remitted_at::text, '—'), coalesce(c.remitted_by::text, '—'))
  FROM public.cod_reconciliations c, prima_conferma p
 WHERE c.rider_id = 'e1406000-0000-0000-0000-000000000002'
   AND c.for_date = (now() AT TIME ZONE 'Europe/Rome')::date;

-- =============================================================================
-- ③ Una rimessa vera dopo: B consegnato nello stesso giorno riapre la giornata,
--   l'amministratore 2 lo conferma e il «versato» diventa il suo
-- =============================================================================
SET LOCAL mycity.allow_order_write = '1';
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  cash_confirmed_at, cash_collected_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e1406000-0000-0000-0000-0000000000b1',
  'e1406000-0000-0000-0000-000000000003', 'e1406000-0000-0000-0000-000000000001',
  'e1406000-0000-0000-0000-000000000002',
  18.00, 1800, 'cod', 'PAID', 'DELIVERED', now(), false, 'AWAITING_REMITTANCE', 1550, 450,
  now(), 1350,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
SET LOCAL mycity.allow_order_write = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1406000-0000-0000-0000-000000000005","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.confirm_cod_remittance(
    'e1406000-0000-0000-0000-000000000002'::uuid, (now() AT TIME ZONE 'Europe/Rome')::date);
  INSERT INTO esiti VALUES (
    '③ la rimessa di B rilascia B',
    (esito->>'rilasciati')::int = 1, esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT '③ dopo la rimessa vera di B la giornata e versata dall amministratore 2',
       c.remitted_at IS NOT NULL AND c.remitted_by = 'e1406000-0000-0000-0000-000000000005',
       format('versata alle %s da %s', coalesce(c.remitted_at::text, '—'), coalesce(c.remitted_by::text, '—'))
  FROM public.cod_reconciliations c
 WHERE c.rider_id = 'e1406000-0000-0000-0000-000000000002'
   AND c.for_date = (now() AT TIME ZONE 'Europe/Rome')::date;

-- =============================================================================
-- Verdetto
-- =============================================================================
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
END $$;

ROLLBACK;
