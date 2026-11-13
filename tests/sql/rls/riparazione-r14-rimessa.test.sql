-- =============================================================================
-- R14-002 — La rimessa non chiude una giornata con contanti ancora in mano
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il registro dei contanti (`cod_reconciliations`) ha una riga per fattorino e
-- per giorno, con un solo «versato» (`remitted_at`). La conferma della rimessa
-- (`confirm_cod_remittance`) lo scriveva SEMPRE, e nessuno lo toglieva piu':
--
--  ① l'amministratore conferma la rimessa dell'ordine A; poco dopo lo stesso
--    fattorino incassa e consegna B, nello stesso giorno. B aspetta la rimessa,
--    ma la giornata resta «versata» all'ora della prima conferma;
--  ② una giornata con un ordine consegnato senza incasso: la conferma lo salta
--    («saltati_senza_incasso: 1») e scrive comunque «versato».
--
-- La guardia della cancellazione (`contantiAncoraDaVersare`) e il sorvegliante
-- delle cancellazioni in attesa leggono proprio `remitted_at`: con la giornata
-- «versata» lasciavano andare un fattorino con i contanti in tasca, e con
-- l'account sparivano la riga del registro e le prove per recuperarli.
--
-- Il contratto (rosso se restituisce righe): nessuna giornata «versata» con un
-- ordine in contanti consegnato quel giorno e ancora da versare.
--
-- Si passa dalle porte vere: la rimessa come amministratore, il codice della
-- consegna come fattorino. Il ricalcolo della quadratura (TypeScript,
-- `aggiornaQuadratura`) qui e' riprodotto con la stessa scrittura che fa lui:
-- un upsert che tocca atteso, incassato e stato, e MAI `remitted_at`.
--
-- Senza la migrazione 381 questa prova e' ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

-- La regola della guardia della cancellazione, scritta com'e' in
-- lib/account/cancellazione.ts (contantiAncoraDaVersare) e in
-- lib/privacy/cancellazioni-in-sospeso.ts (giornataDiCassaAperta): una giornata
-- e' aperta se non risulta versata e o c'e' denaro incassato o non quadra.
CREATE TEMP VIEW guardia_cassa AS
SELECT rider_id, count(*) AS giornate_aperte, coalesce(sum(collected_cents), 0) AS centesimi
  FROM public.cod_reconciliations
 WHERE remitted_at IS NULL
   AND (coalesce(collected_cents, 0) > 0 OR status = 'MISMATCH')
 GROUP BY rider_id;

-- Il contratto della voce: giornate «versate» con contanti ancora da versare.
CREATE TEMP VIEW versate_con_contanti_in_mano AS
SELECT c.rider_id, c.for_date, c.remitted_at, count(o.id) AS ordini
  FROM public.cod_reconciliations c
  JOIN public.orders o
    ON o.rider_id = c.rider_id
   AND o.payment_method = 'cod'
   AND o.delivery_status = 'DELIVERED'
   AND o.payout_status = 'AWAITING_REMITTANCE'
   AND (o.delivered_at AT TIME ZONE 'Europe/Rome')::date = c.for_date
 WHERE c.remitted_at IS NOT NULL
 GROUP BY 1, 2, 3;

-- Lo stesso upsert di aggiornaQuadratura (lib/cassa/quadratura.ts): conta i
-- consegnati in contanti del giorno, scrive atteso/incassato/stato, non tocca
-- `remitted_at`. L'atteso qui e' il totale meno il compenso del fattorino.
CREATE FUNCTION pg_temp.quadra(p_rider uuid, p_giorno date) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.cod_reconciliations (rider_id, for_date, expected_cents, collected_cents, status)
  SELECT p_rider, p_giorno, t.atteso, t.incassato,
         CASE WHEN abs(t.atteso - t.incassato) <= 50 THEN 'OK' ELSE 'MISMATCH' END
    FROM (
      SELECT coalesce(sum(round(o.total_price * 100)::int - coalesce(o.rider_fee_cents, 0)), 0) AS atteso,
             coalesce(sum(coalesce(o.cash_collected_cents, 0)), 0)::int AS incassato
        FROM public.orders o
       WHERE o.rider_id = p_rider
         AND o.payment_method = 'cod'
         AND o.delivery_status = 'DELIVERED'
         AND (o.delivered_at AT TIME ZONE 'Europe/Rome')::date = p_giorno
    ) t
  ON CONFLICT (rider_id, for_date) DO UPDATE
     SET expected_cents = EXCLUDED.expected_cents,
         collected_cents = EXCLUDED.collected_cents,
         status = EXCLUDED.status;
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1400000-0000-0000-0000-000000000001', 'forno-r14@test.it',      '{"role":"seller"}'),
  ('e1400000-0000-0000-0000-000000000002', 'fattorino-r14@test.it',  '{"role":"rider"}'),
  ('e1400000-0000-0000-0000-000000000003', 'cliente-r14@test.it',    '{"role":"buyer"}'),
  ('e1400000-0000-0000-0000-000000000004', 'capo-r14@test.it',       '{"role":"admin"}'),
  ('e1400000-0000-0000-0000-000000000005', 'fattorino2-r14@test.it', '{"role":"rider"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Forno di prova R14',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'e1400000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e1400000-0000-0000-0000-000000000002', 'e1400000-0000-0000-0000-000000000003',
              'e1400000-0000-0000-0000-000000000005');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e1400000-0000-0000-0000-000000000004';

-- =============================================================================
-- ① Rimessa di A, poi il fattorino incassa e consegna B nello stesso giorno
-- =============================================================================
-- A: in contanti, consegnato adesso (il giorno di Piacenza di now(), che in una
-- transazione resta fermo), incasso dichiarato. 25,00 € meno 4,50 di compenso.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  cash_confirmed_at, cash_collected_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e1400000-0000-0000-0000-0000000000a1',
  'e1400000-0000-0000-0000-000000000003', 'e1400000-0000-0000-0000-000000000001',
  'e1400000-0000-0000-0000-000000000002',
  25.00, 2500, 'cod', 'PAID', 'DELIVERED', now(), false, 'AWAITING_REMITTANCE', 2250, 450,
  now(), 2050,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
DO $$ BEGIN PERFORM pg_temp.quadra('e1400000-0000-0000-0000-000000000002', (now() AT TIME ZONE 'Europe/Rome')::date); END $$;

-- L'amministratore conferma la rimessa di oggi, col suo accesso, come la rotta.
SET LOCAL mycity.allow_order_write = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1400000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.confirm_cod_remittance(
    'e1400000-0000-0000-0000-000000000002'::uuid, (now() AT TIME ZONE 'Europe/Rome')::date);
  INSERT INTO esiti VALUES (
    '① premessa: la prima rimessa rilascia A e non salta niente',
    (esito->>'rilasciati')::int = 1 AND (esito->>'saltati_senza_incasso')::int = 0,
    esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT '① premessa: con tutto rilasciato la giornata risulta versata',
       c.remitted_at IS NOT NULL AND c.remitted_by = 'e1400000-0000-0000-0000-000000000004',
       format('versata alle %s da %s', coalesce(c.remitted_at::text, '—'), coalesce(c.remitted_by::text, '—'))
  FROM public.cod_reconciliations c
 WHERE c.rider_id = 'e1400000-0000-0000-0000-000000000002'
   AND c.for_date = (now() AT TIME ZONE 'Europe/Rome')::date;

-- B: 25,00 € in contanti, il fattorino e' in strada e dichiara l'incasso.
SET LOCAL mycity.allow_order_write = '1';
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  cash_confirmed_at, cash_collected_cents, cash_collected_by,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e1400000-0000-0000-0000-0000000000b1',
  'e1400000-0000-0000-0000-000000000003', 'e1400000-0000-0000-0000-000000000001',
  'e1400000-0000-0000-0000-000000000002',
  25.00, 2500, 'cod', 'PAID', 'OUT_FOR_DELIVERY', false, 'AWAITING_REMITTANCE', 2250, 450,
  now(), 2050, 'e1400000-0000-0000-0000-000000000002',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
UPDATE public.order_delivery_codes SET code = '141414'
 WHERE order_id = 'e1400000-0000-0000-0000-0000000000b1';
-- La rotta dell'incasso ricalcola la giornata (B non e' ancora consegnato).
DO $$ BEGIN PERFORM pg_temp.quadra('e1400000-0000-0000-0000-000000000002', (now() AT TIME ZONE 'Europe/Rome')::date); END $$;

-- Il fattorino chiude la consegna di B col codice del cliente.
SET LOCAL mycity.allow_order_write = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1400000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti
SELECT '① premessa: il codice giusto chiude la consegna di B',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('e1400000-0000-0000-0000-0000000000b1', '141414') AS r) t;
RESET ROLE;

INSERT INTO esiti
SELECT '① premessa: B e'' consegnato oggi e aspetta la rimessa',
       o.delivery_status = 'DELIVERED' AND o.payout_status = 'AWAITING_REMITTANCE'
         AND (o.delivered_at AT TIME ZONE 'Europe/Rome')::date = (now() AT TIME ZONE 'Europe/Rome')::date,
       format('stato %s · bonifico %s', o.delivery_status, o.payout_status)
  FROM public.orders o WHERE o.id = 'e1400000-0000-0000-0000-0000000000b1';

-- Il ricalcolo notturno della giornata (riquadra-casse): adesso conta anche B.
DO $$ BEGIN PERFORM pg_temp.quadra('e1400000-0000-0000-0000-000000000002', (now() AT TIME ZONE 'Europe/Rome')::date); END $$;

INSERT INTO esiti
SELECT '① la giornata non resta «versata» con i contanti di B ancora in mano',
       count(*) = 0,
       coalesce(string_agg(format('%s versata alle %s con %s ordini da versare', for_date, remitted_at, ordini), '; '),
                'nessuna giornata versata con contanti in mano')
  FROM versate_con_contanti_in_mano
 WHERE rider_id = 'e1400000-0000-0000-0000-000000000002';

INSERT INTO esiti
SELECT '① la guardia della cancellazione vede la giornata aperta e ferma il fattorino',
       coalesce((SELECT giornate_aperte FROM guardia_cassa
                  WHERE rider_id = 'e1400000-0000-0000-0000-000000000002'), 0) > 0,
       format('giornate aperte per la guardia: %s',
              coalesce((SELECT giornate_aperte FROM guardia_cassa
                         WHERE rider_id = 'e1400000-0000-0000-0000-000000000002'), 0));

-- Il guasto opposto: la giornata riaperta deve potersi richiudere. L'ordine B
-- e' nella pagina delle rimesse; l'amministratore lo conferma e la giornata
-- torna versata (niente giornate aperte per sempre).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1400000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.confirm_cod_remittance(
    'e1400000-0000-0000-0000-000000000002'::uuid, (now() AT TIME ZONE 'Europe/Rome')::date);
  INSERT INTO esiti VALUES (
    '① la seconda rimessa rilascia B',
    (esito->>'rilasciati')::int = 1 AND (esito->>'saltati_senza_incasso')::int = 0,
    esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT '① versato anche B, la giornata si richiude e la guardia la lascia libera',
       c.remitted_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM guardia_cassa g WHERE g.rider_id = c.rider_id),
       format('versata alle %s', coalesce(c.remitted_at::text, '—'))
  FROM public.cod_reconciliations c
 WHERE c.rider_id = 'e1400000-0000-0000-0000-000000000002'
   AND c.for_date = (now() AT TIME ZONE 'Europe/Rome')::date;

-- Quello che NON riapre la giornata: un ordine pagato con la carta e un ordine
-- in contanti di un altro fattorino, consegnati dopo la rimessa.
SET LOCAL mycity.allow_order_write = '1';
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  cash_confirmed_at, cash_collected_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
(
  'e1400000-0000-0000-0000-0000000000c1',
  'e1400000-0000-0000-0000-000000000003', 'e1400000-0000-0000-0000-000000000001',
  'e1400000-0000-0000-0000-000000000002',
  18.00, 1800, 'card', 'PAID', 'DELIVERED', now(), false, 'HELD', 1620, 300,
  NULL, NULL,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
),
(
  'e1400000-0000-0000-0000-0000000000c2',
  'e1400000-0000-0000-0000-000000000003', 'e1400000-0000-0000-0000-000000000001',
  'e1400000-0000-0000-0000-000000000005',
  30.00, 3000, 'cod', 'PAID', 'DELIVERED', now(), false, 'AWAITING_REMITTANCE', 2700, 450,
  now(), 2550,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
SET LOCAL mycity.allow_order_write = '';

INSERT INTO esiti
SELECT '① una consegna con la carta o di un altro fattorino non riapre la giornata versata',
       c.remitted_at IS NOT NULL,
       format('versata alle %s', coalesce(c.remitted_at::text, '—'))
  FROM public.cod_reconciliations c
 WHERE c.rider_id = 'e1400000-0000-0000-0000-000000000002'
   AND c.for_date = (now() AT TIME ZONE 'Europe/Rome')::date;

-- =============================================================================
-- ② Una giornata con un ordine consegnato senza incasso
-- =============================================================================
-- 20 agosto: T consegnato con l'incasso, S consegnato senza. La giornata non
-- quadra (MISMATCH).
SET LOCAL mycity.allow_order_write = '1';
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  cash_confirmed_at, cash_collected_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
(
  'e1400000-0000-0000-0000-0000000000d1',
  'e1400000-0000-0000-0000-000000000003', 'e1400000-0000-0000-0000-000000000001',
  'e1400000-0000-0000-0000-000000000002',
  25.00, 2500, 'cod', 'PAID', 'DELIVERED', '2026-08-20T10:00:00Z', false, 'AWAITING_REMITTANCE', 2250, 450,
  '2026-08-20T09:55:00Z', 2050,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
),
(
  'e1400000-0000-0000-0000-0000000000d2',
  'e1400000-0000-0000-0000-000000000003', 'e1400000-0000-0000-0000-000000000001',
  'e1400000-0000-0000-0000-000000000002',
  25.00, 2500, 'cod', 'PENDING', 'DELIVERED', '2026-08-20T11:00:00Z', false, 'AWAITING_REMITTANCE', 2250, 450,
  NULL, NULL,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
SET LOCAL mycity.allow_order_write = '';
DO $$ BEGIN PERFORM pg_temp.quadra('e1400000-0000-0000-0000-000000000002', DATE '2026-08-20'); END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1400000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.confirm_cod_remittance('e1400000-0000-0000-0000-000000000002'::uuid, DATE '2026-08-20');
  INSERT INTO esiti VALUES (
    '② premessa: la rimessa rilascia T e salta S, che non ha l incasso',
    (esito->>'rilasciati')::int = 1 AND (esito->>'saltati_senza_incasso')::int = 1,
    esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT '② con un ordine saltato la giornata non risulta versata',
       c.remitted_at IS NULL AND c.remitted_by IS NULL,
       format('stato %s · versata alle %s', c.status, coalesce(c.remitted_at::text, '—'))
  FROM public.cod_reconciliations c
 WHERE c.rider_id = 'e1400000-0000-0000-0000-000000000002'
   AND c.for_date = DATE '2026-08-20';

INSERT INTO esiti
SELECT '② e la guardia della cancellazione la conta fra le aperte',
       EXISTS (
         SELECT 1 FROM public.cod_reconciliations c
          WHERE c.rider_id = 'e1400000-0000-0000-0000-000000000002'
            AND c.for_date = DATE '2026-08-20'
            AND c.remitted_at IS NULL
            AND (coalesce(c.collected_cents, 0) > 0 OR c.status = 'MISMATCH')),
       'giornata del 20 agosto per la guardia';

-- L'incasso di S arriva (l'amministratore lo registra al posto del fattorino) e
-- la rimessa ripetuta lo rilascia: la giornata si chiude.
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders
   SET cash_confirmed_at = '2026-08-21T09:00:00Z', cash_collected_cents = 2050, payment_status = 'PAID'
 WHERE id = 'e1400000-0000-0000-0000-0000000000d2';
SET LOCAL mycity.allow_order_write = '';
DO $$ BEGIN PERFORM pg_temp.quadra('e1400000-0000-0000-0000-000000000002', DATE '2026-08-20'); END $$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1400000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE esito jsonb;
BEGIN
  esito := public.confirm_cod_remittance('e1400000-0000-0000-0000-000000000002'::uuid, DATE '2026-08-20');
  INSERT INTO esiti VALUES (
    '② la rimessa ripetuta dopo l incasso rilascia S',
    (esito->>'rilasciati')::int = 1 AND (esito->>'saltati_senza_incasso')::int = 0,
    esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT '② rilasciato S, la giornata del 20 agosto risulta versata',
       c.remitted_at IS NOT NULL AND c.remitted_by = 'e1400000-0000-0000-0000-000000000004',
       format('versata alle %s', coalesce(c.remitted_at::text, '—'))
  FROM public.cod_reconciliations c
 WHERE c.rider_id = 'e1400000-0000-0000-0000-000000000002'
   AND c.for_date = DATE '2026-08-20';

-- =============================================================================
-- Il contratto su tutto il registro
-- =============================================================================
INSERT INTO esiti
SELECT 'nessuna giornata versata con un ordine in contanti consegnato e ancora da versare',
       count(*) = 0,
       coalesce(string_agg(format('%s %s: %s ordini', rider_id, for_date, ordini), '; '), 'nessuna')
  FROM versate_con_contanti_in_mano;

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
