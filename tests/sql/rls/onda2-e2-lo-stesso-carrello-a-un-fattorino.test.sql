-- =============================================================================
-- Onda 2 · R11-006 — Gli ordini pronti dello stesso carrello vanno a un
-- fattorino solo
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Maria compra pane e frutta in un carrello solo: due ordini, due negozi. Gino
-- prende il pane e con lui, nella stessa transazione, la frutta già pronta;
-- Luca, che arriva dopo sulla frutta, legge GIA_PRESO. Coi contanti il carrello
-- si ritrova dalla riga del tentativo di cassa; un ordine ancora in preparazione
-- resta sulla bacheca (la regola su quelli la decide Nicola). Coi permessi veri
-- del fattorino (authenticated + jwt). Senza la migrazione
-- 999r_lo_stesso_carrello_va_a_un_fattorino_solo il file e' ROSSO.
-- Transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2110001-1111-4111-8111-111111111111', 'forno-r11@test.it',     '{"role":"seller"}'),
  ('e2110002-2222-4222-8222-222222222222', 'frutta-r11@test.it',    '{"role":"seller"}'),
  ('e2110003-3333-4333-8333-333333333333', 'gino-r11@test.it',      '{"role":"rider"}'),
  ('e2110004-4444-4444-8444-444444444444', 'luca-r11@test.it',      '{"role":"rider"}'),
  ('e2110005-5555-4555-8555-555555555555', 'maria-r11@test.it',     '{"role":"buyer"}'),
  ('e2110006-6666-4666-8666-666666666666', 'anna-r11@test.it',      '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Negozio R11',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id IN ('e2110001-1111-4111-8111-111111111111', 'e2110002-2222-4222-8222-222222222222');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e2110003-3333-4333-8333-333333333333', 'e2110004-4444-4444-8444-444444444444');

-- Carta: c1 pane e c2 frutta di Maria (stesso gruppo), c3 frutta di Anna (altro carrello, stesso negozio).
-- Contanti: a1 pane pronto, a2 frutta ancora in preparazione, a3 ritiro in negozio, a4 verdura pronta:
-- tutti di Maria, tutti nella stessa riga del tentativo di cassa.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_method, payment_status, delivery_status, pickup_in_store,
  stripe_transfer_group, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
)
SELECT v.id::uuid, v.cliente::uuid, v.negozio::uuid, 15.00, v.metodo, v.pagamento, v.stato, v.ritiro,
       v.gruppo, 'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121', v.compenso
  FROM (VALUES
    ('e2110000-0000-4000-8000-0000000000c1', 'e2110005-5555-4555-8555-555555555555', 'e2110001-1111-4111-8111-111111111111', 'card', 'PAID',    'READY',    false, 'mc_carrello_maria', 300),
    ('e2110000-0000-4000-8000-0000000000c2', 'e2110005-5555-4555-8555-555555555555', 'e2110002-2222-4222-8222-222222222222', 'card', 'PAID',    'READY',    false, 'mc_carrello_maria', 100),
    ('e2110000-0000-4000-8000-0000000000c3', 'e2110006-6666-4666-8666-666666666666', 'e2110002-2222-4222-8222-222222222222', 'card', 'PAID',    'READY',    false, 'mc_carrello_anna',  300),
    ('e2110000-0000-4000-8000-0000000000a1', 'e2110005-5555-4555-8555-555555555555', 'e2110001-1111-4111-8111-111111111111', 'cod',  'PENDING', 'READY',    false, NULL,                300),
    ('e2110000-0000-4000-8000-0000000000a2', 'e2110005-5555-4555-8555-555555555555', 'e2110002-2222-4222-8222-222222222222', 'cod',  'PENDING', 'ACCEPTED', false, NULL,                100),
    ('e2110000-0000-4000-8000-0000000000a3', 'e2110005-5555-4555-8555-555555555555', 'e2110002-2222-4222-8222-222222222222', 'cod',  'PENDING', 'READY',    true,  NULL,                0),
    ('e2110000-0000-4000-8000-0000000000a4', 'e2110005-5555-4555-8555-555555555555', 'e2110002-2222-4222-8222-222222222222', 'cod',  'PENDING', 'READY',    false, NULL,                100)
  ) AS v(id, cliente, negozio, metodo, pagamento, stato, ritiro, gruppo, compenso);

INSERT INTO public.cod_checkout_attempts (chiave, user_id, order_ids) VALUES
  ('r11-maria', 'e2110005-5555-4555-8555-555555555555',
   '[{"id":"e2110000-0000-4000-8000-0000000000a1"},{"id":"e2110000-0000-4000-8000-0000000000a2"},{"id":"e2110000-0000-4000-8000-0000000000a3"},{"id":"e2110000-0000-4000-8000-0000000000a4"}]'::jsonb);

-- Contanti di Anna SENZA la riga del tentativo: b1 e b2 pronti, stessa chiave del carrello sull'ordine.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_method, payment_status, delivery_status, pickup_in_store,
  cod_cart_key, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, rider_fee_cents
) VALUES
  ('e2110000-0000-4000-8000-0000000000b1', 'e2110006-6666-4666-8666-666666666666', 'e2110001-1111-4111-8111-111111111111',
   12.00, 'cod', 'PENDING', 'READY', false, 'r11-anna-senza-riga', 'Anna Bianchi', '3337654321', 'Via Po 3', 'Piacenza', '29121', 300),
  ('e2110000-0000-4000-8000-0000000000b2', 'e2110006-6666-4666-8666-666666666666', 'e2110002-2222-4222-8222-222222222222',
   8.00, 'cod', 'PENDING', 'READY', false, 'r11-anna-senza-riga', 'Anna Bianchi', '3337654321', 'Via Po 3', 'Piacenza', '29121', 100);

SET LOCAL mycity.allow_order_write = '';
SET LOCAL ROLE authenticated;

-- ── carta: Gino prende il pane ────────────────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"e2110003-3333-4333-8333-333333333333","role":"authenticated"}';
CREATE TEMP TABLE r (caso text, risposta jsonb) ON COMMIT DROP;
INSERT INTO r SELECT 'gino pane', public.prendi_ordine('e2110000-0000-4000-8000-0000000000c1');

INSERT INTO esiti SELECT 'carta: la presa del pane riesce e dice la frutta presa insieme',
  (risposta ->> 'ok')::boolean AND risposta -> 'insieme' = '["e2110000-0000-4000-8000-0000000000c2"]'::jsonb, risposta::text
  FROM r WHERE caso = 'gino pane';

-- ── carta: Luca arriva dopo sulla frutta ──────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"e2110004-4444-4444-8444-444444444444","role":"authenticated"}';
INSERT INTO r SELECT 'luca frutta', public.prendi_ordine('e2110000-0000-4000-8000-0000000000c2');
INSERT INTO esiti SELECT 'carta: chi arriva dopo sulla frutta legge GIA_PRESO',
  (risposta ->> 'ok')::boolean IS FALSE AND risposta ->> 'motivo' = 'GIA_PRESO', risposta::text
  FROM r WHERE caso = 'luca frutta';

-- La frutta di Anna è un altro carrello: Luca la prende, da sola.
INSERT INTO r SELECT 'luca anna', public.prendi_ordine('e2110000-0000-4000-8000-0000000000c3');
INSERT INTO esiti SELECT 'un altro carrello resta solo: niente «insieme»',
  (risposta ->> 'ok')::boolean AND risposta -> 'insieme' = '[]'::jsonb, risposta::text
  FROM r WHERE caso = 'luca anna';

-- ── contanti: Luca prende il pane di Maria ────────────────────────────────
INSERT INTO r SELECT 'luca contanti', public.prendi_ordine('e2110000-0000-4000-8000-0000000000a1');
INSERT INTO esiti SELECT 'contanti: col pane si prende la verdura pronta; non la frutta in preparazione né il ritiro in negozio',
  (risposta ->> 'ok')::boolean AND risposta -> 'insieme' = '["e2110000-0000-4000-8000-0000000000a4"]'::jsonb, risposta::text
  FROM r WHERE caso = 'luca contanti';

-- ── contanti senza riga del tentativo: Gino prende b1 di Anna ─────────────
SET LOCAL request.jwt.claims = '{"sub":"e2110003-3333-4333-8333-333333333333","role":"authenticated"}';
INSERT INTO r SELECT 'gino anna chiave', public.prendi_ordine('e2110000-0000-4000-8000-0000000000b1');
INSERT INTO esiti SELECT 'contanti senza la riga del tentativo: la chiave del carrello porta anche b2',
  (risposta ->> 'ok')::boolean AND risposta -> 'insieme' = '["e2110000-0000-4000-8000-0000000000b2"]'::jsonb, risposta::text
  FROM r WHERE caso = 'gino anna chiave';

RESET ROLE;

INSERT INTO esiti SELECT 'carta: pane e frutta di Maria sono tutti e due di Gino',
  bool_and(rider_id = 'e2110003-3333-4333-8333-333333333333' AND delivery_status = 'ASSIGNED'),
  string_agg(id::text || ':' || coalesce(rider_id::text, '-') || ':' || delivery_status, ', ')
  FROM public.orders WHERE id IN ('e2110000-0000-4000-8000-0000000000c1', 'e2110000-0000-4000-8000-0000000000c2');
INSERT INTO esiti SELECT 'contanti: pane e verdura di Maria sono tutti e due di Luca',
  bool_and(rider_id = 'e2110004-4444-4444-8444-444444444444' AND delivery_status = 'ASSIGNED'),
  string_agg(id::text || ':' || coalesce(rider_id::text, '-') || ':' || delivery_status, ', ')
  FROM public.orders WHERE id IN ('e2110000-0000-4000-8000-0000000000a1', 'e2110000-0000-4000-8000-0000000000a4');
INSERT INTO esiti SELECT 'la frutta di Anna è di Luca', rider_id = 'e2110004-4444-4444-8444-444444444444', coalesce(rider_id::text, '-')
  FROM public.orders WHERE id = 'e2110000-0000-4000-8000-0000000000c3';
INSERT INTO esiti SELECT 'contanti: la frutta ancora in preparazione resta libera sulla bacheca',
  rider_id IS NULL AND delivery_status = 'ACCEPTED', coalesce(rider_id::text, '-') || ':' || delivery_status
  FROM public.orders WHERE id = 'e2110000-0000-4000-8000-0000000000a2';
INSERT INTO esiti SELECT 'contanti: il ritiro in negozio non va a nessun fattorino',
  rider_id IS NULL AND delivery_status = 'READY', coalesce(rider_id::text, '-') || ':' || delivery_status
  FROM public.orders WHERE id = 'e2110000-0000-4000-8000-0000000000a3';
INSERT INTO esiti SELECT 'le righe del giro si bloccano in ordine di id prima della presa',
  pg_get_functiondef('public.prendi_ordine(uuid)'::regprocedure) ~* 'order\s+by\s+id\s+for\s+update', '';
INSERT INTO esiti SELECT 'gli anonimi non la possono chiamare',
  NOT has_function_privilege('anon', 'public.prendi_ordine(uuid)', 'EXECUTE'), '';

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text; quanti int;
BEGIN
  SELECT count(*) INTO quanti FROM esiti;
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF quanti < 11 THEN RAISE EXCEPTION 'solo % controlli: ne manca qualcuno', quanti; END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul carrello a un fattorino solo:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'lo stesso carrello va a un fattorino solo: % controlli verdi', quanti;
END $$;

ROLLBACK;
