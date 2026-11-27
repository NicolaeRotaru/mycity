-- =============================================================================
-- Il bonifico fatto a mano ha uno stato che il database accetta
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R22 (26/11/2026). Il lunedì Nicola versa a mano ai negozi i contanti della
-- settimana prima, e «Bonifico fatto» porta quegli ordini a PAID_MANUALLY. Il
-- vincolo della 130 su orders.payout_status non conosceva quello stato: la
-- scrittura cadeva, l'ordine restava HELD e il lunedì dopo tornava «da versare».
--
-- COSA CONTROLLA, con un ordine in contanti consegnato:
--   ① PAID_MANUALLY, con la data del bonifico, resta scritto;
--   ② gli stati di prima restano tutti accettati (l'elenco della 130);
--   ③ uno stato inventato resta rifiutato.
--
-- Senza la migrazione 916 questa prova è ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2210000-0000-0000-0000-00000000000a', 'fornaio-r22b@test.it', '{"role":"seller"}'),
  ('e2210000-0000-0000-0000-00000000000b', 'mario-r22b@test.it',   '{"role":"buyer"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'e2210000-0000-0000-0000-00000000000a';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e2210000-1111-0000-0000-000000000001', 'e2210000-0000-0000-0000-00000000000b', 'e2210000-0000-0000-0000-00000000000a',
   15.00, 1500, 'cod', 'PAID', 'DELIVERED', 'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121');
UPDATE public.orders
   SET payout_status = 'HELD', seller_payout_cents = 1350, delivered_at = '2026-11-18T10:00:00Z'
 WHERE id = 'e2210000-1111-0000-0000-000000000001';

CREATE OR REPLACE FUNCTION pg_temp.scrivi(p_stato text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.orders SET payout_status = p_stato, payout_at = '2026-11-23T08:30:00Z'
   WHERE id = 'e2210000-1111-0000-0000-000000000001';
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;

-- ① Il bonifico fatto a mano resta scritto.
INSERT INTO esiti SELECT 'PAID_MANUALLY si scrive', r = 'PASSATO', 'risposta: ' || r FROM pg_temp.scrivi('PAID_MANUALLY') AS r;
INSERT INTO esiti
SELECT 'e resta, con la data del bonifico', o.payout_status = 'PAID_MANUALLY' AND o.payout_at = '2026-11-23T08:30:00Z'::timestamptz,
       coalesce(o.payout_status, '-') || ' ' || coalesce(o.payout_at::text, 'senza data')
  FROM public.orders o WHERE o.id = 'e2210000-1111-0000-0000-000000000001';

-- ② Gli stati di prima.
INSERT INTO esiti
SELECT 'gli stati della 130 restano accettati', bool_and(r = 'PASSATO'), string_agg(s || '=' || r, ', ')
  FROM unnest(ARRAY['PENDING', 'HELD', 'PROCESSING', 'TRANSFERRED', 'REFUNDED', 'FAILED', 'PENDING_SELLER_ONBOARDING',
                    'REVERSED', 'REVERSAL_FAILED', 'AWAITING_REMITTANCE', 'CASH_IN_STORE']) AS s,
       LATERAL pg_temp.scrivi(s) AS r;

-- ③ Uno stato inventato.
INSERT INTO esiti SELECT 'uno stato inventato resta rifiutato', r = '23514', 'risposta: ' || r FROM pg_temp.scrivi('PAGATO_FORSE') AS r;

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF (SELECT count(*) FROM esiti) <> 4 THEN
    RAISE EXCEPTION 'la prova doveva fare 4 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sullo stato del bonifico fatto a mano:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il bonifico fatto a mano resta scritto: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
