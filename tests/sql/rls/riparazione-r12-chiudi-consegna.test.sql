-- =============================================================================
-- R12-001 — Se il fattorino sparisce, l'amministratore chiude la consegna
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Un ordine in contanti resta in strada: il fattorino non ha dichiarato i
-- contanti e non riapre piu' l'app. Dalla 163 nessuno poteva chiuderlo.
--   ① l'amministratore, senza incasso: NON chiude (regola della 163);
--   ② il fattorino stesso o un cliente: NON possono usare la funzione;
--   ③ senza motivo: NON chiude;
--   ④ dopo l'incasso registrato: chiude, con delivered_at e una riga di registro;
--   ⑤ un ordine non ancora partito: NON si chiude.
-- Senza la migrazione 360 la funzione non esiste e il file e' ROSSO.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1200000-0000-0000-0000-000000000001', 'fornaio-r12@test.it',   '{"role":"seller"}'),
  ('e1200000-0000-0000-0000-000000000002', 'fattorino-r12@test.it', '{"role":"rider"}'),
  ('e1200000-0000-0000-0000-000000000003', 'cliente-r12@test.it',   '{"role":"buyer"}'),
  ('e1200000-0000-0000-0000-000000000004', 'capo-r12@test.it',      '{"role":"admin"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane R12',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'e1200000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e1200000-0000-0000-0000-000000000002', 'e1200000-0000-0000-0000-000000000003');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e1200000-0000-0000-0000-000000000004';

INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
(
  'e1200000-0000-0000-0000-0000000000c1',
  'e1200000-0000-0000-0000-000000000003', 'e1200000-0000-0000-0000-000000000001',
  'e1200000-0000-0000-0000-000000000002',
  25.00, 2500, 'cod', 'PENDING', 'OUT_FOR_DELIVERY', false, 'AWAITING_REMITTANCE', 2250, 300,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
),
(
  'e1200000-0000-0000-0000-0000000000c2',
  'e1200000-0000-0000-0000-000000000003', 'e1200000-0000-0000-0000-000000000001',
  'e1200000-0000-0000-0000-000000000002',
  18.00, 1800, 'cod', 'PENDING', 'ACCEPTED', false, 'AWAITING_REMITTANCE', 1620, 300,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

SET LOCAL mycity.allow_order_write = '';

-- ── ① amministratore, contanti non ancora registrati ──────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1200000-0000-0000-0000-000000000004","role":"authenticated"}';
INSERT INTO esiti
SELECT '1 senza incasso l amministratore non chiude (regola della 163)',
       r ->> 'reason' = 'CASH_NOT_CONFIRMED', r::text
  FROM (SELECT public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1',
               'Fattorino irraggiungibile da tre giorni') AS r) t;

-- ── ③ senza motivo ────────────────────────────────────────────────────────
INSERT INTO esiti
SELECT '3 senza motivo non chiude', r ->> 'reason' = 'MOTIVO_MANCANTE', r::text
  FROM (SELECT public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1', '  ') AS r) t;

-- ── ② il fattorino e il cliente ───────────────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"e1200000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti
SELECT '2a il fattorino non puo chiudere da qui', r ->> 'reason' = 'NOT_ADMIN', r::text
  FROM (SELECT public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1',
               'Me la chiudo da solo senza codice') AS r) t;
SET LOCAL request.jwt.claims = '{"sub":"e1200000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO esiti
SELECT '2b il cliente non puo chiudere', r ->> 'reason' = 'NOT_ADMIN', r::text
  FROM (SELECT public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1',
               'Me la chiudo da solo senza codice') AS r) t;
RESET ROLE;

-- ── ④ dopo l'incasso registrato dall'amministratore ───────────────────────
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders SET cash_confirmed_at = now(), cash_collected_cents = 2500,
       cash_collected_by = 'e1200000-0000-0000-0000-000000000004', payment_status = 'PAID'
 WHERE id = 'e1200000-0000-0000-0000-0000000000c1';
SET LOCAL mycity.allow_order_write = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1200000-0000-0000-0000-000000000004","role":"authenticated"}';
INSERT INTO esiti
SELECT '4a dopo l incasso l amministratore chiude', (r ->> 'ok')::boolean IS TRUE, r::text
  FROM (SELECT public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c1',
               'Fattorino irraggiungibile da tre giorni') AS r) t;
-- ── ⑤ un ordine non ancora partito ────────────────────────────────────────
INSERT INTO esiti
SELECT '5 un ordine non partito non si chiude', r ->> 'reason' = 'WRONG_STATUS', r::text
  FROM (SELECT public.admin_chiudi_consegna('e1200000-0000-0000-0000-0000000000c2',
               'Fattorino irraggiungibile da tre giorni') AS r) t;
RESET ROLE;

INSERT INTO esiti
SELECT '4b l ordine e consegnato con la sua ora', o.delivery_status = 'DELIVERED' AND o.delivered_at IS NOT NULL,
       o.delivery_status || ' ' || coalesce(o.delivered_at::text, 'senza ora')
  FROM public.orders o WHERE o.id = 'e1200000-0000-0000-0000-0000000000c1';
INSERT INTO esiti
SELECT '4c il registro nomina l amministratore e il motivo', count(*) = 1, count(*)::text || ' righe'
  FROM public.audit_logs
 WHERE action = 'order.delivery_closed_by_admin'
   AND target_id = 'e1200000-0000-0000-0000-0000000000c1'
   AND actor_id = 'e1200000-0000-0000-0000-000000000004'
   AND metadata ->> 'motivo' = 'Fattorino irraggiungibile da tre giorni';
INSERT INTO esiti
SELECT '6 gli anonimi non la possono chiamare',
       NOT has_function_privilege('anon', 'public.admin_chiudi_consegna(uuid, text)', 'EXECUTE'), '';

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulla chiusura della consegna:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'l amministratore chiude la consegna: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
