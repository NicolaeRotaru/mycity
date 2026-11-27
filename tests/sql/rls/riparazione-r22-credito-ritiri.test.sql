-- =============================================================================
-- «Bonifico fatto»: sul ritiro pagato in parte col credito MyCity, il credito torna al negozio
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R22 (26/11/2026, giro di correzione). Il credito MyCity è attivo anche sui contanti:
-- su un ritiro al banco il negozio incassa il lordo meno il credito, ma la sua quota
-- nasce sul lordo. Quindi per ogni ritiro MyCity gli deve «credito − commissione», non
-- «− commissione». segna_bonifico_manuale (916) toglieva solo la commissione.
--
-- COSA CONTROLLA:
--   ① 10,00 € di contanti + un ritiro da 20 € con 5 € di credito e 2 € di commissione:
--     il bonifico è 13,00 € (la funzione rifiuta gli 8,00 € di prima);
--   ② un ritiro da solo con 5 € di credito e 2 € di commissione: bonifico da 3,00 €,
--     col riferimento, niente in fattura;
--   ③ un ritiro senza credito con 2 € di commissione contro 1,00 € di contanti: 0 versati,
--     1,00 € in fattura, come prima.
--
-- Senza la correzione della 916 questa prova è ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2230000-0000-0000-0000-00000000000a', 'fornaio-r22k@test.it', '{"role":"seller"}'),
  ('e2230000-0000-0000-0000-00000000000d', 'bottega-r22k@test.it', '{"role":"seller"}'),
  ('e2230000-0000-0000-0000-00000000000e', 'orto-r22k@test.it',    '{"role":"seller"}'),
  ('e2230000-0000-0000-0000-00000000000b', 'mario-r22k@test.it',   '{"role":"buyer"}'),
  ('e2230000-0000-0000-0000-00000000000c', 'anna-r22k@test.it',    '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Negozio ' || left(id::text, 8)
 WHERE id IN ('e2230000-0000-0000-0000-00000000000a', 'e2230000-0000-0000-0000-00000000000d', 'e2230000-0000-0000-0000-00000000000e');
UPDATE public.profiles SET role = 'admin', full_name = 'Anna Conti' WHERE id = 'e2230000-0000-0000-0000-00000000000c';

-- c1 contanti 10,00 € e a1 ritiro (20 € lordi, 5 € di credito) del forno; a2 ritiro con credito
-- della bottega; c3 contanti 1,00 € e a3 ritiro senza credito dell'orto.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, wallet_applied_cents,
  payment_method, payment_status, delivery_status, pickup_in_store,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e2230000-0000-0000-0000-00000000000b', v.seller::uuid, (2000 - v.credito) / 100.0, 2000, v.credito,
       'cod', 'PAID', 'DELIVERED', v.ritiro,
       'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    ('e2230000-1111-0000-0000-0000000000c1', 'e2230000-0000-0000-0000-00000000000a', false,   0),
    ('e2230000-1111-0000-0000-0000000000a1', 'e2230000-0000-0000-0000-00000000000a', true,  500),
    ('e2230000-1111-0000-0000-0000000000a2', 'e2230000-0000-0000-0000-00000000000d', true,  500),
    ('e2230000-1111-0000-0000-0000000000c3', 'e2230000-0000-0000-0000-00000000000e', false,   0),
    ('e2230000-1111-0000-0000-0000000000a3', 'e2230000-0000-0000-0000-00000000000e', true,    0)
  ) AS v(id, seller, ritiro, credito);
UPDATE public.orders o
   SET payout_status = CASE WHEN o.pickup_in_store THEN 'CASH_IN_STORE' ELSE 'HELD' END,
       seller_payout_cents = CASE o.id WHEN 'e2230000-1111-0000-0000-0000000000c1'::uuid THEN 1000
                                       WHEN 'e2230000-1111-0000-0000-0000000000c3'::uuid THEN 100 ELSE 1800 END,
       application_fee_cents = 200, delivered_at = '2026-11-18T10:00:00Z'
 WHERE o.id::text LIKE 'e2230000-1111-%';

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE || CASE WHEN SQLERRM LIKE 'BONIFICO_%' THEN ' ' || left(SQLERRM, 60) ELSE '' END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2230000-0000-0000-0000-00000000000c","role":"authenticated"}';
-- ① Il forno: 10,00 + 5,00 − 2,00 = 13,00 €.
INSERT INTO esiti SELECT 'gli 8,00 € di prima (contanti meno commissione) sono rifiutati', r LIKE 'P0001 BONIFICO_CAMBIATO%', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale('e2230000-0000-0000-0000-00000000000a',
       ARRAY['e2230000-1111-0000-0000-0000000000c1']::uuid[], 'CRO-FORNO',
       ARRAY['e2230000-1111-0000-0000-0000000000a1']::uuid[], 800)$q$) AS r;
INSERT INTO esiti SELECT 'il bonifico del forno è 13,00 €', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale('e2230000-0000-0000-0000-00000000000a',
       ARRAY['e2230000-1111-0000-0000-0000000000c1']::uuid[], 'CRO-FORNO',
       ARRAY['e2230000-1111-0000-0000-0000000000a1']::uuid[], 1300)$q$) AS r;
-- ② La bottega: solo un ritiro, 5,00 − 2,00 = 3,00 €.
INSERT INTO esiti SELECT 'un ritiro da solo col credito: bonifico da 3,00 €', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale('e2230000-0000-0000-0000-00000000000d',
       '{}'::uuid[], 'CRO-BOTTEGA', ARRAY['e2230000-1111-0000-0000-0000000000a2']::uuid[], 300)$q$) AS r;
-- ③ L'orto: commissione sopra i contanti, nessun credito: compensazione.
INSERT INTO esiti SELECT 'senza credito la compensazione resta com era', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale('e2230000-0000-0000-0000-00000000000e',
       ARRAY['e2230000-1111-0000-0000-0000000000c3']::uuid[], NULL,
       ARRAY['e2230000-1111-0000-0000-0000000000a3']::uuid[], 0)$q$) AS r;
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'le righe dei bonifici: 1300 versati / 300 versati / 0 versati e 100 in fattura',
       string_agg(format('%s/%s/%s', b.importo_cents, b.trattenuta_cents, b.in_fattura_cents), ' ' ORDER BY b.riferimento NULLS LAST)
         = '300/200/0 1300/200/0 0/100/100',
       string_agg(format('%s/%s/%s %s', b.importo_cents, b.trattenuta_cents, b.in_fattura_cents, coalesce(b.riferimento, '-')), ' ' ORDER BY b.riferimento NULLS LAST)
  FROM private.bonifici_manuali b
 WHERE b.seller_id IN ('e2230000-0000-0000-0000-00000000000a', 'e2230000-0000-0000-0000-00000000000d', 'e2230000-0000-0000-0000-00000000000e');

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF (SELECT count(*) FROM esiti) <> 5 THEN
    RAISE EXCEPTION 'la prova doveva fare 5 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul credito dei ritiri:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il credito dei ritiri torna al negozio: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
