-- =============================================================================
-- R26-019 — «Conferma rimessa» sblocca solo gli incassi che l'amministratore ha visto
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- L'amministratore apre la pagina delle rimesse: del fattorino, oggi, vede UN
-- ordine in contanti (A) e conta i suoi contanti. Mentre conta, il fattorino
-- chiude un'altra consegna (B) e ne registra l'incasso. Il clic su «Conferma»
-- rendeva pagabile anche B, i cui contanti nessuno ha visto.
--
-- La conferma con l'elenco degli ordini visti (migrazione 501) rilascia A e
-- lascia B in attesa. Senza la 501 la prova fa quello che fa la rotta (la
-- forma per giorno) ed e' ROSSA: anche B diventa pagabile.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('d2600000-0000-0000-0000-000000000001', 'fornaio-r26@test.it',   '{"role":"seller"}'),
  ('d2600000-0000-0000-0000-000000000002', 'fattorino-r26@test.it', '{"role":"rider"}'),
  ('d2600000-0000-0000-0000-000000000003', 'cliente-r26@test.it',   '{"role":"buyer"}'),
  ('d2600000-0000-0000-0000-000000000004', 'capo-r26@test.it',      '{"role":"admin"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       store_address = 'Via Roma 1, Piacenza'
 WHERE id = 'd2600000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('d2600000-0000-0000-0000-000000000002', 'd2600000-0000-0000-0000-000000000003');
UPDATE public.profiles SET role = 'admin' WHERE id = 'd2600000-0000-0000-0000-000000000004';

-- A: la consegna che l'amministratore vede quando apre la pagina.
-- B: la consegna chiusa (con l'incasso) mentre la pagina era aperta.
INSERT INTO public.orders (
  id, user_id, seller_id, rider_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, cash_confirmed_at, cash_collected_cents, pickup_in_store, payout_status,
  seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
(
  'd2600000-0000-0000-0000-0000000000a1',
  'd2600000-0000-0000-0000-000000000003', 'd2600000-0000-0000-0000-000000000001',
  'd2600000-0000-0000-0000-000000000002',
  25.00, 2500, 'cod', 'PAID', 'DELIVERED', now(), now(), 2200, false, 'AWAITING_REMITTANCE', 2250, 300,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
),
(
  'd2600000-0000-0000-0000-0000000000b2',
  'd2600000-0000-0000-0000-000000000003', 'd2600000-0000-0000-0000-000000000001',
  'd2600000-0000-0000-0000-000000000002',
  40.00, 4000, 'cod', 'PAID', 'DELIVERED', now(), now(), 3700, false, 'AWAITING_REMITTANCE', 3600, 300,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
SET LOCAL mycity.allow_order_write = '';

-- La conferma, come la preme l'amministratore: con l'elenco di quello che vedeva.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d2600000-0000-0000-0000-000000000004","role":"authenticated"}';
DO $$
DECLARE esito jsonb; giorno date;
BEGIN
  SELECT (delivered_at AT TIME ZONE 'Europe/Rome')::date INTO giorno
    FROM public.orders WHERE id = 'd2600000-0000-0000-0000-0000000000a1';
  -- Come fa la rotta: la forma con l'elenco se c'e', se no quella per giorno.
  IF to_regprocedure('public.confirm_cod_remittance(uuid,date,uuid[])') IS NOT NULL THEN
    EXECUTE 'SELECT public.confirm_cod_remittance($1, $2, $3)' INTO esito
      USING 'd2600000-0000-0000-0000-000000000002'::uuid, giorno,
            ARRAY['d2600000-0000-0000-0000-0000000000a1']::uuid[];
  ELSE
    esito := public.confirm_cod_remittance('d2600000-0000-0000-0000-000000000002'::uuid, giorno);
  END IF;
  INSERT INTO esiti VALUES (
    'la conferma rilascia un ordine solo: quello visto',
    (esito->>'rilasciati')::int = 1 AND (esito->>'saltati_senza_incasso')::int = 0,
    esito::text);
END $$;
RESET ROLE;

INSERT INTO esiti
SELECT 'l ordine visto entra nel giro dei bonifici',
       o.payout_status = 'HELD', 'stato del bonifico: ' || o.payout_status
  FROM public.orders o WHERE o.id = 'd2600000-0000-0000-0000-0000000000a1';

INSERT INTO esiti
SELECT 'l ordine arrivato dopo resta in attesa di rimessa',
       o.payout_status = 'AWAITING_REMITTANCE', 'stato del bonifico: ' || o.payout_status
  FROM public.orders o WHERE o.id = 'd2600000-0000-0000-0000-0000000000b2';

-- Chi non e' amministratore non conferma niente, nemmeno con l'elenco.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d2600000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE rifiutato boolean := false;
BEGIN
  BEGIN
    IF to_regprocedure('public.confirm_cod_remittance(uuid,date,uuid[])') IS NOT NULL THEN
      EXECUTE 'SELECT public.confirm_cod_remittance($1, $2, $3)'
        USING 'd2600000-0000-0000-0000-000000000002'::uuid, current_date,
              ARRAY['d2600000-0000-0000-0000-0000000000b2']::uuid[];
    ELSE
      PERFORM public.confirm_cod_remittance('d2600000-0000-0000-0000-000000000002'::uuid, current_date);
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN rifiutato := true;
  END;
  INSERT INTO esiti VALUES ('il fattorino non si conferma la rimessa da solo', rifiutato, 'rifiutato: ' || rifiutato);
END $$;
RESET ROLE;

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
    RAISE EXCEPTION E'% controllo/i rosso/i sulla rimessa contanti:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la rimessa conferma solo gli ordini visti: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
