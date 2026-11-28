-- =============================================================================
-- «Bonifico fatto»: il contante di un ritiro al banco rimborsato torna a MyCity (999j)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Sul ritiro al banco il negozio tiene in cassa il contante; il rimborso al cliente lo fa MyCity.
-- Col rimborso pieno refundOrder porta l'ordine a payout_status = 'REFUNDED' e scrive tutta la quota
-- del negozio in seller_payout_reversed_cents. Il negozio deve allora a MyCity la commissione e il
-- recupero del rimborso (la quota stornata, al massimo il netto), meno il credito MyCity usato dal
-- cliente: cioè il contante che ha in cassa. La commissione non trattenuta va in fattura; il recupero
-- non trattenuto, o arrivato dopo il bonifico, si legge fra le quote da recuperare.
--
-- COSA CONTROLLA, con ordini da 20 € (commissione 2,00 €, netto 18,00 €):
--   ① Forno Verdi: due contanti da 18,00 € e un ritiro rimborsato per intero (reclamo chiuso LOST)
--     → commissione 2,00 € e recupero 18,00 €, il bonifico è 36,00 € − 20,00 € = 16,00 €;
--   ② Bottega Neri: ritiro rimborsato per intero pagato con 5,00 € di credito MyCity → in cassa ha
--     15,00 €: compensazione da 0 € (5,00 € di recupero trattenuti dal credito), in fattura solo i
--     2,00 € di commissione, 13,00 € di recupero fra le quote da recuperare;
--   ③ un contante (non ritiro) rimborsato per intero e un ritiro rimborsato con un reso aperto:
--     rifiutati;
--   ④ Drogheria Gialli: due ritiri regolati (2,00 € ciascuno), poi uno rimborsato per intero e uno in
--     parte (4,50 € di quota del negozio) → fra le quote da recuperare 18,00 € e 4,50 €; un ritiro
--     regolato senza rimborsi dopo, o col recupero già trattenuto tutto, non compare.
--
-- Senza la 999j ①, ② e ④ sono ROSSI. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2520000-0000-0000-0000-00000000000a', 'forno-verdi@test.it',     '{"role":"seller"}'),
  ('e2520000-0000-0000-0000-00000000000d', 'bottega-neri@test.it',    '{"role":"seller"}'),
  ('e2520000-0000-0000-0000-00000000000e', 'drogheria-gialli@test.it', '{"role":"seller"}'),
  ('e2520000-0000-0000-0000-00000000000b', 'mario-s01j@test.it',      '{"role":"buyer"}'),
  ('e2520000-0000-0000-0000-00000000000c', 'anna-s01j@test.it',       '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved',
       store_name = CASE id WHEN 'e2520000-0000-0000-0000-00000000000a'::uuid THEN 'Forno Verdi'
                            WHEN 'e2520000-0000-0000-0000-00000000000d'::uuid THEN 'Bottega Neri'
                            ELSE 'Drogheria Gialli' END
 WHERE id IN ('e2520000-0000-0000-0000-00000000000a', 'e2520000-0000-0000-0000-00000000000d', 'e2520000-0000-0000-0000-00000000000e');
UPDATE public.profiles SET role = 'admin', full_name = 'Anna Conti' WHERE id = 'e2520000-0000-0000-0000-00000000000c';

-- f1, f2 contanti del forno; f3 ritiro del forno rimborsato per intero. b1 ritiro della bottega
-- rimborsato per intero, con 5,00 € di credito; b2 contante rimborsato per intero; b3 ritiro
-- rimborsato per intero con un reso aperto. g1, g2, g3 ritiri della drogheria.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, pickup_in_store,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e2520000-0000-0000-0000-00000000000b', v.negozio::uuid, 20.00, 2000,
       'cod', 'PAID', 'DELIVERED', v.ritiro,
       'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    ('e2520000-1111-0000-0000-0000000000f1', 'e2520000-0000-0000-0000-00000000000a', false),
    ('e2520000-1111-0000-0000-0000000000f2', 'e2520000-0000-0000-0000-00000000000a', false),
    ('e2520000-1111-0000-0000-0000000000f3', 'e2520000-0000-0000-0000-00000000000a', true),
    ('e2520000-1111-0000-0000-0000000000b1', 'e2520000-0000-0000-0000-00000000000d', true),
    ('e2520000-1111-0000-0000-0000000000b2', 'e2520000-0000-0000-0000-00000000000d', false),
    ('e2520000-1111-0000-0000-0000000000b3', 'e2520000-0000-0000-0000-00000000000d', true),
    ('e2520000-1111-0000-0000-0000000000e1', 'e2520000-0000-0000-0000-00000000000e', true),
    ('e2520000-1111-0000-0000-0000000000e2', 'e2520000-0000-0000-0000-00000000000e', true),
    ('e2520000-1111-0000-0000-0000000000e3', 'e2520000-0000-0000-0000-00000000000e', true)
  ) AS v(id, negozio, ritiro);

-- Come li lascia la cassa: contanti HELD, ritiri CASH_IN_STORE.
UPDATE public.orders o
   SET payout_status = CASE WHEN o.pickup_in_store THEN 'CASH_IN_STORE' ELSE 'HELD' END,
       seller_payout_cents = 1800, application_fee_cents = 200, delivered_at = '2026-11-18T10:00:00Z',
       wallet_applied_cents = CASE WHEN o.id = 'e2520000-1111-0000-0000-0000000000b1'::uuid THEN 500 ELSE 0 END
 WHERE o.seller_id IN ('e2520000-0000-0000-0000-00000000000a', 'e2520000-0000-0000-0000-00000000000d', 'e2520000-0000-0000-0000-00000000000e');

-- Come li lascia il rimborso pieno (refundOrder): REFUNDED su pagamento e bonifico, la quota del
-- negozio stornata tutta. f3 col reclamo chiuso a favore del cliente (LOST).
UPDATE public.orders o
   SET payment_status = 'REFUNDED', payout_status = 'REFUNDED', seller_payout_reversed_cents = 1800,
       refunded_amount_cents = 2000,
       internal_dispute_status = CASE WHEN o.id = 'e2520000-1111-0000-0000-0000000000f3'::uuid THEN 'LOST' END
 WHERE o.id IN ('e2520000-1111-0000-0000-0000000000f3', 'e2520000-1111-0000-0000-0000000000b1',
                'e2520000-1111-0000-0000-0000000000b2', 'e2520000-1111-0000-0000-0000000000b3');

INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, created_at)
VALUES ('e2520000-2222-0000-0000-000000000001', 'e2520000-1111-0000-0000-0000000000b3',
        'e2520000-0000-0000-0000-00000000000b', 'e2520000-0000-0000-0000-00000000000d',
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
SET LOCAL request.jwt.claims = '{"sub":"e2520000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ① Forno Verdi: 36,00 € − 20,00 € = 16,00 €.
INSERT INTO esiti SELECT '1a il bonifico col ritiro rimborsato per intero passa: 16,00 €', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2520000-0000-0000-0000-00000000000a',
       ARRAY['e2520000-1111-0000-0000-0000000000f1', 'e2520000-1111-0000-0000-0000000000f2'],
       ARRAY['e2520000-1111-0000-0000-0000000000f3'], 'CRO-VERDI-1', 1600)) AS r;

-- ② Bottega Neri: 2,00 € + 18,00 € − 5,00 € di credito = 15,00 €, tutto in fattura.
INSERT INTO esiti SELECT '2a il ritiro rimborsato per intero pagato in parte col credito: compensazione da 0 €', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2520000-0000-0000-0000-00000000000d',
       ARRAY[]::text[], ARRAY['e2520000-1111-0000-0000-0000000000b1'], NULL, 0)) AS r;

-- ③ Restano fuori il contante rimborsato (il negozio non ha incassato niente) e il ritiro col reso aperto.
INSERT INTO esiti SELECT '3a un contante rimborsato per intero non entra fra i ritiri', r LIKE 'P0001 BONIFICO_CAMBIATO%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2520000-0000-0000-0000-00000000000d',
       ARRAY[]::text[], ARRAY['e2520000-1111-0000-0000-0000000000b2'], NULL, 0)) AS r;
INSERT INTO esiti SELECT '3b un ritiro rimborsato per intero con un reso aperto è rifiutato', r LIKE 'P0001 BONIFICO_CAMBIATO%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2520000-0000-0000-0000-00000000000d',
       ARRAY[]::text[], ARRAY['e2520000-1111-0000-0000-0000000000b3'], NULL, 0)) AS r;

-- ④ Drogheria Gialli: tre ritiri regolati prima di ogni rimborso (2,00 € ciascuno, in fattura).
INSERT INTO esiti SELECT '4a i tre ritiri della drogheria si regolano: compensazione da 0 €', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2520000-0000-0000-0000-00000000000e', ARRAY[]::text[],
       ARRAY['e2520000-1111-0000-0000-0000000000e1', 'e2520000-1111-0000-0000-0000000000e2', 'e2520000-1111-0000-0000-0000000000e3'], NULL, 0)) AS r;

RESET request.jwt.claims;
RESET ROLE;

-- Dopo il bonifico: g1 rimborsato per intero, g2 in parte (4,50 € di quota del negozio), g3 niente.
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders SET payment_status = 'REFUNDED', payout_status = 'REFUNDED', seller_payout_reversed_cents = 1800, refunded_amount_cents = 2000
 WHERE id = 'e2520000-1111-0000-0000-0000000000e1';
UPDATE public.orders SET payment_status = 'PARTIALLY_REFUNDED', seller_payout_reversed_cents = 450, refunded_amount_cents = 500
 WHERE id = 'e2520000-1111-0000-0000-0000000000e2';
RESET mycity.allow_order_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2520000-0000-0000-0000-00000000000c","role":"authenticated"}';
CREATE TEMP TABLE da_recuperare ON COMMIT DROP AS
  SELECT d.order_id, d.da_recuperare_cents FROM public.contanti_da_recuperare() d
   WHERE d.seller_id IN ('e2520000-0000-0000-0000-00000000000a', 'e2520000-0000-0000-0000-00000000000d', 'e2520000-0000-0000-0000-00000000000e');
RESET request.jwt.claims;
RESET ROLE;

-- Quello che resta scritto.
INSERT INTO esiti
SELECT '1b il bonifico del forno: commissione 2,00 €, recupero 18,00 €, trattenuti 20,00 €, versati 16,00 €',
       count(*) = 1 AND bool_and(b.commissione_cents = 200 AND b.recupero_cents = 1800 AND b.recupero_trattenuto_cents = 1800
                                 AND b.trattenuta_cents = 2000 AND b.importo_cents = 1600
                                 AND b.in_fattura_cents = 0 AND b.riferimento = 'CRO-VERDI-1')
         AND (SELECT l.cents = 200 AND l.recupero_cents = 1800 FROM private.bonifici_manuali_ordini l WHERE l.order_id = 'e2520000-1111-0000-0000-0000000000f3')
         AND (SELECT o.payout_at IS NOT NULL FROM public.orders o WHERE o.id = 'e2520000-1111-0000-0000-0000000000f3'),
       coalesce(string_agg(format('commissione %s · recupero %s (trattenuto %s) · trattenuta %s · importo %s · in fattura %s',
                b.commissione_cents, b.recupero_cents, b.recupero_trattenuto_cents, b.trattenuta_cents, b.importo_cents,
                b.in_fattura_cents), ', '), '(nessuno)')
  FROM private.bonifici_manuali b WHERE b.seller_id = 'e2520000-0000-0000-0000-00000000000a';
INSERT INTO esiti
SELECT '2b la compensazione della bottega: in fattura 2,00 € di commissione, 5,00 € di recupero trattenuti dal credito',
       count(*) = 1 AND bool_and(b.commissione_cents = 200 AND b.credito_cents = 500 AND b.recupero_cents = 1800
                                 AND b.recupero_trattenuto_cents = 500 AND b.trattenuta_cents = 500
                                 AND b.importo_cents = 0 AND b.in_fattura_cents = 200),
       coalesce(string_agg(format('commissione %s · credito %s · recupero %s (trattenuto %s) · trattenuta %s · importo %s · in fattura %s',
                b.commissione_cents, b.credito_cents, b.recupero_cents, b.recupero_trattenuto_cents, b.trattenuta_cents,
                b.importo_cents, b.in_fattura_cents), ', '), '(nessuno)')
  FROM private.bonifici_manuali b WHERE b.seller_id = 'e2520000-0000-0000-0000-00000000000d';
INSERT INTO esiti
SELECT '3c i due rifiutati restano da regolare',
       (SELECT count(*) FROM public.orders o
         WHERE o.id IN ('e2520000-1111-0000-0000-0000000000b2', 'e2520000-1111-0000-0000-0000000000b3') AND o.payout_at IS NULL) = 2,
       (SELECT count(*) FROM public.orders o
         WHERE o.id IN ('e2520000-1111-0000-0000-0000000000b2', 'e2520000-1111-0000-0000-0000000000b3') AND o.payout_at IS NULL) || ' su 2 ancora aperti';
INSERT INTO esiti
SELECT '4b da recuperare: 18,00 € e 4,50 € dalla drogheria, 13,00 € dalla bottega (il recupero che il credito non copriva)',
       (SELECT d.da_recuperare_cents FROM da_recuperare d WHERE d.order_id = 'e2520000-1111-0000-0000-0000000000e1') = 1800
         AND (SELECT d.da_recuperare_cents FROM da_recuperare d WHERE d.order_id = 'e2520000-1111-0000-0000-0000000000e2') = 450
         AND (SELECT d.da_recuperare_cents FROM da_recuperare d WHERE d.order_id = 'e2520000-1111-0000-0000-0000000000b1') = 1300,
       coalesce((SELECT string_agg(format('%s → %s', right(d.order_id::text, 2), d.da_recuperare_cents), ', ' ORDER BY d.order_id) FROM da_recuperare d), '(nessuna riga)');
INSERT INTO esiti
SELECT '4c un ritiro regolato senza rimborsi dopo, o col recupero già trattenuto tutto, non compare',
       NOT EXISTS (SELECT 1 FROM da_recuperare d
                    WHERE d.order_id IN ('e2520000-1111-0000-0000-0000000000e3', 'e2520000-1111-0000-0000-0000000000f3')),
       coalesce((SELECT string_agg(right(d.order_id::text, 2), ', ') FROM da_recuperare d), '(nessuna riga)');

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF (SELECT count(*) FROM esiti) <> 10 THEN
    RAISE EXCEPTION 'la prova doveva fare 10 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul ritiro rimborsato per intero:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il contante del ritiro rimborsato torna a MyCity: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
