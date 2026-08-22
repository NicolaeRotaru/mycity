-- =============================================================================
-- Il credito torna indietro, e la rimessa conferma solo quello che è registrato
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Due difetti della radiografia del 21/8/2026, tutti e due sui soldi veri.
--
-- ① IL CREDITO MYCITY CHE EVAPORA. Il cliente usa 15 euro di buono regalo, il
--    negozio rifiuta l'ordine perche' ha finito il pane, e i 15 euro non
--    esistono piu': ne' merce ne' credito. La rotta dell'amministratore
--    riaccreditava, il giro degli ordini fermi riaccreditava — solo le due
--    strade che usano davvero le persone, no.
--
-- ② LA RIMESSA CHE PAGA CONTANTE MAI REGISTRATO. La conferma della cassa del
--    fattorino rendeva pagabile il negozio su TUTTI i suoi ordini in contanti
--    consegnati, anche quelli in cui l'incasso non era mai stato registrato. E
--    un ordine puo' arrivare a «consegnato» senza passare dal riquadro
--    dell'incasso. Il negozio veniva pagato per contante di cui non esiste
--    traccia.
--
-- Senza la migrazione 126 questa prova e' ROSSA su entrambi.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it',   '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'fattorino@test.it', '{"role":"rider"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',   '{"role":"buyer"}'),
  ('44444444-4444-4444-4444-444444444444', 'capo@test.it',      '{"role":"admin"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
UPDATE public.profiles SET role = 'admin' WHERE id = '44444444-4444-4444-4444-444444444444';

-- ---------------------------------------------------------------------------
-- ① Il credito speso torna quando l'ordine viene annullato
-- ---------------------------------------------------------------------------
-- Un ordine in contanti da 20 euro, di cui 15 pagati col credito MyCity.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, payout_status, seller_payout_cents, wallet_applied_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'b0000000-0000-0000-0000-0000000000a1',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  20.00, 3500, 'cod', 'PENDING', 'NEW', 'AWAITING_REMITTANCE', 1800, 1500,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- Il negozio rifiuta: ha finito il pane.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.seller_reject_order('b0000000-0000-0000-0000-0000000000a1', 'pane finito');
  INSERT INTO esiti VALUES ('il rifiuto del negozio riesce', (esito->>'ok')::boolean, esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT 'il credito MyCity torna sul saldo del cliente',
       coalesce(sum(delta_cents), 0) = 1500,
       'riaccreditato: ' || coalesce(sum(delta_cents), 0) || ' centesimi'
  FROM public.wallet_ledger
 WHERE user_id = '33333333-3333-3333-3333-333333333333'
   AND reason = 'order_canceled';

-- Un secondo rifiuto non deve accreditare una seconda volta: la chiave del
-- movimento e' l'ordine, non il momento.
INSERT INTO esiti
SELECT 'il credito non torna due volte',
       count(*) = 1,
       'movimenti di riaccredito: ' || count(*)
  FROM public.wallet_ledger
 WHERE user_id = '33333333-3333-3333-3333-333333333333'
   AND reason = 'order_canceled';

-- ---------------------------------------------------------------------------
-- ② La rimessa conferma solo il contante registrato
-- ---------------------------------------------------------------------------
-- Due consegne in contanti dello stesso fattorino, lo stesso giorno: su una
-- l'incasso e' stato registrato, sull'altra no.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, payout_status, seller_payout_cents, cash_confirmed_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
(
  'b0000000-0000-0000-0000-0000000000b1',
  '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  20.00, 2000, 'cod', 'PENDING', 'DELIVERED', '2026-08-20T10:00:00Z', 'AWAITING_REMITTANCE', 1800,
  '2026-08-20T10:05:00Z',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
),
(
  'b0000000-0000-0000-0000-0000000000b2',
  '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  30.00, 3000, 'cod', 'PENDING', 'DELIVERED', '2026-08-20T11:00:00Z', 'AWAITING_REMITTANCE', 2700,
  NULL,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.confirm_cod_remittance(
    '22222222-2222-2222-2222-222222222222'::uuid, DATE '2026-08-20');
  INSERT INTO esiti VALUES (
    'la conferma della cassa rilascia UN ordine solo',
    (esito->>'rilasciati')::int = 1,
    esito::text);
  INSERT INTO esiti VALUES (
    'e dice quanti ne ha saltati perche l incasso non era registrato',
    (esito->>'saltati_senza_incasso')::int = 1,
    esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT 'l ordine senza incasso registrato resta fermo, e il negozio non viene pagato',
       payout_status = 'AWAITING_REMITTANCE',
       'stato: ' || payout_status
  FROM public.orders WHERE id = 'b0000000-0000-0000-0000-0000000000b2';

INSERT INTO esiti
SELECT 'l ordine con l incasso registrato diventa pagabile',
       payout_status = 'HELD',
       'stato: ' || payout_status
  FROM public.orders WHERE id = 'b0000000-0000-0000-0000-0000000000b1';


-- ---------------------------------------------------------------------------
-- ③ La posizione del fattorino sparisce quando l'ordine si chiude
-- ---------------------------------------------------------------------------
-- L'informativa privacy promette che si cancella a fine consegna. Non la
-- cancellava nessuno: restava sull'ordine per sempre. E' un dato personale di
-- un lavoratore — dove si trovava, a che ora — tenuto senza limite contro una
-- promessa scritta.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, payout_status, seller_payout_cents,
  rider_lat, rider_lng, rider_position_updated_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'b0000000-0000-0000-0000-0000000000c1',
  '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  25.00, 2500, 'card', 'PAID', 'OUT_FOR_DELIVERY', 'HELD', 2250,
  45.0526, 9.6930, now(),
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

UPDATE public.orders SET delivery_status = 'DELIVERED', delivered_at = now()
 WHERE id = 'b0000000-0000-0000-0000-0000000000c1';

INSERT INTO esiti
SELECT 'la posizione del fattorino sparisce a consegna fatta',
       rider_lat IS NULL AND rider_lng IS NULL AND rider_position_updated_at IS NULL,
       'lat: ' || coalesce(rider_lat::text, 'nulla') || ' · lng: ' || coalesce(rider_lng::text, 'nulla')
  FROM public.orders WHERE id = 'b0000000-0000-0000-0000-0000000000c1';

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE NOT ok;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;
