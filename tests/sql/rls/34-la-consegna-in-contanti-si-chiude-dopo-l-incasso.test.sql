-- =============================================================================
-- La consegna in contanti si chiude solo dopo l'incasso, e il negozio viene pagato
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R33 (radiografia dell'11/10/2026). Negli ordini in contanti le conferme sono
-- due: il codice alla porta e l'incasso dichiarato dal fattorino. Il database
-- accettava il codice senza l'incasso; la rimessa della sera saltava l'ordine
-- (nessun incasso registrato) e il negozio non veniva pagato.
--
-- Qui si percorre la strada vera, col fattorino collegato:
--   ① contanti, incasso non dichiarato, codice GIUSTO → l'ordine NON si chiude,
--      e non si consuma nemmeno un tentativo;
--   ② lo stesso ordine, dopo l'incasso → si chiude, e la rimessa lo paga;
--   ③ una consegna con la carta non cambia niente;
--   ④ il caso gia' successo prima di questa migrazione (consegnato senza
--      incasso): la rimessa lo salta, ma appena l'incasso arriva — anche tardi
--      — la stessa rimessa ripetuta lo rilascia. E' la strada per recuperare.
--
-- Senza la migrazione 163 il controllo ① e' ROSSO.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('d3000000-0000-0000-0000-000000000001', 'fornaio-34@test.it',   '{"role":"seller"}'),
  ('d3000000-0000-0000-0000-000000000002', 'fattorino-34@test.it', '{"role":"rider"}'),
  ('d3000000-0000-0000-0000-000000000003', 'cliente-34@test.it',   '{"role":"buyer"}'),
  ('d3000000-0000-0000-0000-000000000004', 'capo-34@test.it',      '{"role":"admin"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'd3000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('d3000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000003');
UPDATE public.profiles SET role = 'admin' WHERE id = 'd3000000-0000-0000-0000-000000000004';

-- Due consegne in strada dello stesso fattorino: una in contanti da 25 euro,
-- una pagata con la carta.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
(
  'd3000000-0000-0000-0000-0000000000c1',
  'd3000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000001',
  'd3000000-0000-0000-0000-000000000002',
  25.00, 2500, 'cod', 'PENDING', 'OUT_FOR_DELIVERY', false, 'AWAITING_REMITTANCE', 2250, 300,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
),
(
  'd3000000-0000-0000-0000-0000000000c2',
  'd3000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000001',
  'd3000000-0000-0000-0000-000000000002',
  18.00, 1800, 'card', 'PAID', 'OUT_FOR_DELIVERY', false, 'HELD', 1620, 300,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- I codici li crea un trigger suo, casuali: qui si fissano per poterli digitare.
UPDATE public.order_delivery_codes SET code = '343434'
 WHERE order_id = 'd3000000-0000-0000-0000-0000000000c1';
UPDATE public.order_delivery_codes SET code = '565656'
 WHERE order_id = 'd3000000-0000-0000-0000-0000000000c2';

-- ── ① Contanti, incasso non dichiarato, codice giusto ─────────────────────
SET LOCAL mycity.allow_order_write = '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d3000000-0000-0000-0000-000000000002","role":"authenticated"}';

INSERT INTO esiti
SELECT 'contanti senza incasso dichiarato: il codice giusto NON chiude la consegna',
       (r ->> 'ok')::boolean IS NOT TRUE AND r ->> 'reason' = 'CASH_NOT_CONFIRMED',
       'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('d3000000-0000-0000-0000-0000000000c1', '343434') AS r) t;

RESET ROLE;

INSERT INTO esiti
SELECT 'l ordine in contanti resta in strada',
       o.delivery_status = 'OUT_FOR_DELIVERY' AND o.delivered_at IS NULL,
       format('stato %s · consegnato il %s', o.delivery_status, coalesce(o.delivered_at::text, '—'))
  FROM public.orders o WHERE o.id = 'd3000000-0000-0000-0000-0000000000c1';

INSERT INTO esiti
SELECT 'il rifiuto per incasso mancante non consuma un tentativo del codice',
       c.attempts = 0 AND c.locked_until IS NULL AND c.verified_at IS NULL,
       format('tentativi %s · bloccato fino a %s · verificato %s',
              c.attempts, coalesce(c.locked_until::text, '—'), coalesce(c.verified_at::text, '—'))
  FROM public.order_delivery_codes c WHERE c.order_id = 'd3000000-0000-0000-0000-0000000000c1';

-- ── ② Lo stesso ordine dopo l'incasso ─────────────────────────────────────
-- E' quello che scrive /api/rider/cash-confirm (col client di servizio).
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders
   SET cash_confirmed_at = now(), cash_collected_cents = 2200,
       cash_collected_by = 'd3000000-0000-0000-0000-000000000002', payment_status = 'PAID'
 WHERE id = 'd3000000-0000-0000-0000-0000000000c1';
SET LOCAL mycity.allow_order_write = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d3000000-0000-0000-0000-000000000002","role":"authenticated"}';

INSERT INTO esiti
SELECT 'dopo l incasso il codice giusto chiude la consegna in contanti',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('d3000000-0000-0000-0000-0000000000c1', '343434') AS r) t;

-- ── ③ La carta non cambia ─────────────────────────────────────────────────
INSERT INTO esiti
SELECT 'una consegna pagata con la carta si chiude col codice come prima',
       (r ->> 'ok')::boolean IS TRUE,
       'risposta: ' || r::text
  FROM (SELECT public.verify_delivery_code('d3000000-0000-0000-0000-0000000000c2', '565656') AS r) t;

RESET ROLE;

-- ── ④ Il caso gia' successo: consegnato senza incasso ─────────────────────
-- Un ordine chiuso PRIMA di questa migrazione, nello stesso giorno di Piacenza
-- della consegna di ②: in archivio esiste davvero, la regola nuova non lo tocca.
SET LOCAL mycity.allow_order_write = '1';
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT 'd3000000-0000-0000-0000-0000000000c3',
       'd3000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000001',
       'd3000000-0000-0000-0000-000000000002',
       30.00, 3000, 'cod', 'PENDING', 'DELIVERED', o.delivered_at, false, 'AWAITING_REMITTANCE', 2700, 300,
       'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM public.orders o WHERE o.id = 'd3000000-0000-0000-0000-0000000000c1';
SET LOCAL mycity.allow_order_write = '';

-- La rimessa della sera, come la preme l'amministratore.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d3000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE esito jsonb; giorno date;
BEGIN
  SELECT (delivered_at AT TIME ZONE 'Europe/Rome')::date INTO giorno
    FROM public.orders WHERE id = 'd3000000-0000-0000-0000-0000000000c1';
  esito := public.confirm_cod_remittance('d3000000-0000-0000-0000-000000000002'::uuid, giorno);
  INSERT INTO esiti VALUES (
    'la rimessa paga la consegna chiusa dopo l incasso, e salta quella senza',
    (esito->>'rilasciati')::int = 1 AND (esito->>'saltati_senza_incasso')::int = 1,
    esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT 'il negozio della consegna in contanti di ② entra nel giro dei bonifici',
       o.payout_status = 'HELD',
       'stato del bonifico: ' || o.payout_status
  FROM public.orders o WHERE o.id = 'd3000000-0000-0000-0000-0000000000c1';

-- L'incasso arriva tardi: il fattorino lo dichiara dalla bacheca (o lo
-- registra l'amministratore). E' la stessa scrittura di /api/rider/cash-confirm.
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders
   SET cash_confirmed_at = now(), cash_collected_cents = 2700,
       cash_collected_by = 'd3000000-0000-0000-0000-000000000002', payment_status = 'PAID'
 WHERE id = 'd3000000-0000-0000-0000-0000000000c3';
SET LOCAL mycity.allow_order_write = '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d3000000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE esito jsonb; giorno date;
BEGIN
  SELECT (delivered_at AT TIME ZONE 'Europe/Rome')::date INTO giorno
    FROM public.orders WHERE id = 'd3000000-0000-0000-0000-0000000000c3';
  esito := public.confirm_cod_remittance('d3000000-0000-0000-0000-000000000002'::uuid, giorno);
  INSERT INTO esiti VALUES (
    'la stessa rimessa, ripetuta dopo l incasso tardivo, rilascia l ordine rimasto indietro',
    (esito->>'rilasciati')::int = 1 AND (esito->>'saltati_senza_incasso')::int = 0,
    esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT 'il negozio dell ordine recuperato entra nel giro dei bonifici',
       o.payout_status = 'HELD',
       'stato del bonifico: ' || o.payout_status
  FROM public.orders o WHERE o.id = 'd3000000-0000-0000-0000-0000000000c3';

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
    RAISE EXCEPTION E'% controllo/i rosso/i sulla consegna in contanti:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la consegna in contanti si chiude dopo l incasso: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
