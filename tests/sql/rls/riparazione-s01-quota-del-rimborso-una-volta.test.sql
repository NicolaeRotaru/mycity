-- =============================================================================
-- La quota del negozio di un rimborso si toglie una volta sola per chiave (999j)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- refundOrder (lib/stripe/payout.ts) toglie la quota del negozio con togli_quota_del_rimborso, che
-- scrive la chiave del rimborso e la quota nella stessa transazione. Un rimborso interrotto e ripreso
-- con la stessa chiave chiama di nuovo: la seconda volta la funzione risponde 0 e non tocca niente.
--
-- COSA CONTROLLA, su un ritiro da 20 € (netto del negozio 18,00 €):
--   ① la chiave k1 toglie 4,50 €; la stessa chiave di nuovo risponde 0 e la quota resta 4,50 €;
--   ② una chiave nuova toglie al massimo quello che resta del netto (13,50 €, non 18,00 €);
--   ③ argomenti storti: 22023; ordine che non c'è: P0002;
--   ④ anon e authenticated non la possono chiamare.
--
-- Senza la 999j la funzione non c'è e la prova è ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2530000-0000-0000-0000-00000000000a', 'forno-quota@test.it', '{"role":"seller"}'),
  ('e2530000-0000-0000-0000-00000000000b', 'mario-quota@test.it', '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Forno Blu'
 WHERE id = 'e2530000-0000-0000-0000-00000000000a';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, pickup_in_store,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e2530000-1111-0000-0000-000000000001', 'e2530000-0000-0000-0000-00000000000b', 'e2530000-0000-0000-0000-00000000000a',
  20.00, 2000, 'cod', 'PAID', 'DELIVERED', true,
  'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
UPDATE public.orders
   SET payout_status = 'CASH_IN_STORE', seller_payout_cents = 1800, application_fee_cents = 200,
       seller_payout_reversed_cents = 0, delivered_at = '2026-11-18T10:00:00Z'
 WHERE id = 'e2530000-1111-0000-0000-000000000001';

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE p_sql INTO r;
  RETURN coalesce(r, 'null');
EXCEPTION WHEN others THEN
  RETURN 'ERRORE ' || SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.togli(p_chiave text, p_cents int, p_ordine text DEFAULT 'e2530000-1111-0000-0000-000000000001') RETURNS text
LANGUAGE sql AS $$
  SELECT format('SELECT public.togli_quota_del_rimborso(%L::uuid, %L, %s)::text', p_ordine, p_chiave, p_cents)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.togli(text, int, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.stornato() RETURNS int
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT seller_payout_reversed_cents FROM public.orders WHERE id = 'e2530000-1111-0000-0000-000000000001'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.stornato() TO anon, authenticated, service_role;

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

-- ① La stessa chiave due volte.
INSERT INTO esiti SELECT '1a la chiave k1 toglie 4,50 €', r = '450', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.togli('return_k1', 450)) AS r;
INSERT INTO esiti SELECT '1b la stessa chiave di nuovo risponde 0', r = '0', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.togli('return_k1', 450)) AS r;
INSERT INTO esiti SELECT '1c la quota resta 4,50 €', pg_temp.stornato() = 450, 'stornato: ' || pg_temp.stornato();

-- ② Una chiave nuova, oltre il netto.
INSERT INTO esiti SELECT '2a una chiave nuova toglie solo quello che resta del netto: 13,50 €', r = '1350', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.togli('dispute_k2', 1800)) AS r;
INSERT INTO esiti SELECT '2b la quota arriva al netto e non lo supera', pg_temp.stornato() = 1800, 'stornato: ' || pg_temp.stornato();

-- ③ Argomenti storti e ordine che non c'è.
INSERT INTO esiti SELECT '3a chiave vuota: 22023', r = 'ERRORE 22023', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.togli('  ', 100)) AS r;
INSERT INTO esiti SELECT '3b centesimi negativi: 22023', r = 'ERRORE 22023', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.togli('return_k3', -1)) AS r;
INSERT INTO esiti SELECT '3c ordine che non c''è: P0002', r = 'ERRORE P0002', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.togli('return_k4', 100, 'e2530000-1111-0000-0000-0000000000ff')) AS r;

RESET request.jwt.claims;
RESET ROLE;

-- ④ Dal browser no.
SET LOCAL ROLE anon;
INSERT INTO esiti SELECT '4a anon non la può chiamare', r = 'ERRORE 42501', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.togli('return_k5', 100)) AS r;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2530000-0000-0000-0000-00000000000a","role":"authenticated"}';
INSERT INTO esiti SELECT '4b il negozio stesso non la può chiamare', r = 'ERRORE 42501', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.togli('return_k6', 100)) AS r;
RESET request.jwt.claims;
RESET ROLE;
INSERT INTO esiti SELECT '4c dopo i rifiuti la quota è quella di prima', pg_temp.stornato() = 1800, 'stornato: ' || pg_temp.stornato();

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF (SELECT count(*) FROM esiti) <> 11 THEN
    RAISE EXCEPTION 'la prova doveva fare 11 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulla quota del rimborso:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la quota del rimborso si toglie una volta sola: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
