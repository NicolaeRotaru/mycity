-- =============================================================================
-- «Bonifico fatto»: il ritiro al banco rimborsato in parte si regola (999i)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il negozio tiene in cassa tutto il contante del ritiro; il rimborso parziale al cliente lo fa
-- MyCity, e la quota del negozio resta scritta in seller_payout_reversed_cents. Quando si segna il
-- bonifico, quel ritiro entra con la commissione più la quota stornata (al massimo il netto del
-- negozio), e la cifra si toglie dai contanti come la commissione.
--
-- COSA CONTROLLA, con i numeri veri:
--   ① Forno Rossi: contanti 18,00 €; ritiro da 20 € con commissione 2,00 €, rimborso parziale di
--     5 € con 4,50 € di quota del negozio → il negozio deve 6,50 €, il bonifico è 11,50 €. La cifra
--     di prima (16,00 €, senza la quota) è rifiutata; quella giusta passa e resta scritta;
--   ② Bottega Bianchi: quota stornata 25,00 € su un netto di 18,00 € → si conta 18,00 € (LEAST),
--     il negozio deve 20,00 €: compensazione da 0 €, 20,00 € in fattura;
--   ③ un ritiro rimborsato per intero, e uno rimborsato in parte con un reso aperto: rifiutati.
--
-- Senza la 999i ① e ② sono ROSSI. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2510000-0000-0000-0000-00000000000a', 'forno-s01@test.it',   '{"role":"seller"}'),
  ('e2510000-0000-0000-0000-00000000000d', 'bottega-s01@test.it', '{"role":"seller"}'),
  ('e2510000-0000-0000-0000-00000000000b', 'mario-s01@test.it',   '{"role":"buyer"}'),
  ('e2510000-0000-0000-0000-00000000000c', 'anna-s01@test.it',    '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Forno Rossi'
 WHERE id = 'e2510000-0000-0000-0000-00000000000a';
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega Bianchi'
 WHERE id = 'e2510000-0000-0000-0000-00000000000d';
UPDATE public.profiles SET role = 'admin', full_name = 'Anna Conti' WHERE id = 'e2510000-0000-0000-0000-00000000000c';

-- Tutti da 20 €, consegnati, in contanti. f1 contanti del forno; f2 ritiro del forno rimborsato in
-- parte. b1 ritiro della bottega con la quota stornata sopra il netto; b2 ritiro rimborsato per
-- intero; b3 ritiro rimborsato in parte con un reso aperto.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, pickup_in_store,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e2510000-0000-0000-0000-00000000000b', v.negozio::uuid, 20.00, 2000,
       'cod', v.pagamento, 'DELIVERED', v.ritiro,
       'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    ('e2510000-1111-0000-0000-0000000000f1', 'e2510000-0000-0000-0000-00000000000a', false, 'PAID'),
    ('e2510000-1111-0000-0000-0000000000f2', 'e2510000-0000-0000-0000-00000000000a', true,  'PARTIALLY_REFUNDED'),
    ('e2510000-1111-0000-0000-0000000000b1', 'e2510000-0000-0000-0000-00000000000d', true,  'PARTIALLY_REFUNDED'),
    ('e2510000-1111-0000-0000-0000000000b2', 'e2510000-0000-0000-0000-00000000000d', true,  'REFUNDED'),
    ('e2510000-1111-0000-0000-0000000000b3', 'e2510000-0000-0000-0000-00000000000d', true,  'PARTIALLY_REFUNDED')
  ) AS v(id, negozio, ritiro, pagamento);

UPDATE public.orders o
   SET payout_status = CASE WHEN o.pickup_in_store THEN 'CASH_IN_STORE' ELSE 'HELD' END,
       seller_payout_cents = 1800, application_fee_cents = 200, delivered_at = '2026-11-18T10:00:00Z',
       seller_payout_reversed_cents = CASE o.id
         WHEN 'e2510000-1111-0000-0000-0000000000f2'::uuid THEN 450
         WHEN 'e2510000-1111-0000-0000-0000000000b1'::uuid THEN 2500
         WHEN 'e2510000-1111-0000-0000-0000000000b3'::uuid THEN 450
         ELSE 0 END
 WHERE o.seller_id IN ('e2510000-0000-0000-0000-00000000000a', 'e2510000-0000-0000-0000-00000000000d');

INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, created_at)
VALUES ('e2510000-2222-0000-0000-000000000001', 'e2510000-1111-0000-0000-0000000000b3',
        'e2510000-0000-0000-0000-00000000000b', 'e2510000-0000-0000-0000-00000000000d',
        'DAMAGED', 'REQUESTED', '2026-11-19T09:00:00Z');

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE || CASE WHEN SQLERRM LIKE 'BONIFICO_%' THEN ' ' || SQLERRM ELSE '' END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.bonifico(p_negozio text, p_contanti text[], p_ritiri text[], p_rif text, p_importo int) RETURNS text
LANGUAGE sql AS $$
  SELECT format($q$SELECT public.segna_bonifico_manuale(%L::uuid, %L::uuid[], %L, %L::uuid[], %s)$q$,
                p_negozio, p_contanti, p_rif, p_ritiri, p_importo)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.bonifico(text, text[], text[], text, int) TO anon, authenticated, service_role;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2510000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ① Forno Rossi: 18,00 € − (2,00 € + 4,50 €) = 11,50 €.
INSERT INTO esiti SELECT '1a la cifra senza la quota stornata (16,00 €) è rifiutata: quella giusta è 11,50 €',
       r LIKE 'P0001 BONIFICO_CAMBIATO%1150 centesimi%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2510000-0000-0000-0000-00000000000a',
       ARRAY['e2510000-1111-0000-0000-0000000000f1'], ARRAY['e2510000-1111-0000-0000-0000000000f2'], 'CRO-FORNO-1', 1600)) AS r;
INSERT INTO esiti SELECT '1b il bonifico da 11,50 € col ritiro rimborsato in parte passa', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2510000-0000-0000-0000-00000000000a',
       ARRAY['e2510000-1111-0000-0000-0000000000f1'], ARRAY['e2510000-1111-0000-0000-0000000000f2'], 'CRO-FORNO-1', 1150)) AS r;

-- ② Bottega Bianchi: quota stornata 25,00 € su un netto di 18,00 € → 2,00 € + 18,00 € = 20,00 €.
INSERT INTO esiti SELECT '2a la quota stornata sopra il netto conta fino al netto: compensazione da 0 € accettata', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2510000-0000-0000-0000-00000000000d',
       ARRAY[]::text[], ARRAY['e2510000-1111-0000-0000-0000000000b1'], NULL, 0)) AS r;

-- ③ I cancelli di prima reggono.
INSERT INTO esiti SELECT '3a un ritiro rimborsato per intero è rifiutato', r LIKE 'P0001 BONIFICO_CAMBIATO%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2510000-0000-0000-0000-00000000000d',
       ARRAY[]::text[], ARRAY['e2510000-1111-0000-0000-0000000000b2'], NULL, 0)) AS r;
INSERT INTO esiti SELECT '3b un ritiro rimborsato in parte con un reso aperto è rifiutato', r LIKE 'P0001 BONIFICO_CAMBIATO%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2510000-0000-0000-0000-00000000000d',
       ARRAY[]::text[], ARRAY['e2510000-1111-0000-0000-0000000000b3'], NULL, 0)) AS r;

RESET request.jwt.claims;
RESET ROLE;

-- Quello che resta scritto.
INSERT INTO esiti
SELECT '1c il bonifico del forno: commissione 6,50 €, trattenuta 6,50 €, versati 11,50 €, niente in fattura',
       count(*) = 1 AND bool_and(b.commissione_cents = 650 AND b.trattenuta_cents = 650 AND b.importo_cents = 1150
                                 AND b.in_fattura_cents = 0 AND b.riferimento = 'CRO-FORNO-1'),
       coalesce(string_agg(format('commissione %s · trattenuta %s · importo %s · in fattura %s · %s',
                b.commissione_cents, b.trattenuta_cents, b.importo_cents, b.in_fattura_cents, b.riferimento), ', '), '(nessuno)')
  FROM private.bonifici_manuali b WHERE b.seller_id = 'e2510000-0000-0000-0000-00000000000a';
INSERT INTO esiti
SELECT '1d il ritiro del forno è regolato per 6,50 € e resta CASH_IN_STORE; i contanti sono PAID_MANUALLY',
       (SELECT l.cents FROM private.bonifici_manuali_ordini l WHERE l.order_id = 'e2510000-1111-0000-0000-0000000000f2') = 650
         AND (SELECT o.payout_at IS NOT NULL AND o.payout_status = 'CASH_IN_STORE' FROM public.orders o WHERE o.id = 'e2510000-1111-0000-0000-0000000000f2')
         AND (SELECT o.payout_status = 'PAID_MANUALLY' FROM public.orders o WHERE o.id = 'e2510000-1111-0000-0000-0000000000f1'),
       (SELECT format('ritiro %s centesimi, %s', l.cents, o.payout_status)
          FROM private.bonifici_manuali_ordini l JOIN public.orders o ON o.id = l.order_id
         WHERE l.order_id = 'e2510000-1111-0000-0000-0000000000f2');
INSERT INTO esiti
SELECT '2b la compensazione della bottega: 20,00 € dovuti, 20,00 € in fattura',
       count(*) = 1 AND bool_and(b.commissione_cents = 2000 AND b.importo_cents = 0 AND b.in_fattura_cents = 2000 AND b.riferimento IS NULL)
         AND (SELECT l.cents FROM private.bonifici_manuali_ordini l WHERE l.order_id = 'e2510000-1111-0000-0000-0000000000b1') = 2000,
       coalesce(string_agg(format('commissione %s · importo %s · in fattura %s', b.commissione_cents, b.importo_cents, b.in_fattura_cents), ', '), '(nessuno)')
  FROM private.bonifici_manuali b WHERE b.seller_id = 'e2510000-0000-0000-0000-00000000000d';
INSERT INTO esiti
SELECT '3c i ritiri rifiutati restano da regolare',
       (SELECT count(*) FROM public.orders o
         WHERE o.id IN ('e2510000-1111-0000-0000-0000000000b2', 'e2510000-1111-0000-0000-0000000000b3') AND o.payout_at IS NULL) = 2,
       (SELECT count(*) FROM public.orders o
         WHERE o.id IN ('e2510000-1111-0000-0000-0000000000b2', 'e2510000-1111-0000-0000-0000000000b3') AND o.payout_at IS NULL) || ' su 2 ancora aperti';

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF (SELECT count(*) FROM esiti) <> 9 THEN
    RAISE EXCEPTION 'la prova doveva fare 9 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul ritiro rimborsato in parte:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il ritiro rimborsato in parte si regola: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
