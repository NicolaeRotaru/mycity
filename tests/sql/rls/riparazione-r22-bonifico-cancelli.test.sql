-- =============================================================================
-- «Bonifico fatto»: i ritiri al banco hanno gli stessi cancelli dei contanti, e il
-- secondo clic con un riferimento o una cifra diversi non passa in silenzio
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R22 (26/11/2026, giro di correzione). La funzione segna_bonifico_manuale (916)
-- accettava un ritiro al banco con un reso aperto, un reclamo interno aperto o il
-- pagamento rimborsato in parte, e ne regolava la commissione; per i contanti gli
-- stessi casi erano fermi. E un secondo clic sullo stesso bonifico con un CRO o una
-- cifra diversi rispondeva «fatto» e teneva il CRO del primo, senza dirlo.
--
-- 28/11/2026 (999i) — Il ritiro rimborsato in parte non aspetta più: aspettare non aveva una
-- fine (niente lo rimetteva in gioco) e la commissione non si regolava mai. Adesso si regola con
-- la commissione più la quota del negozio nel rimborso (④). Reso e reclamo aperti restano fermi.
--
-- COSA CONTROLLA, con il forno di Pane Quotidiano:
--   ① un ritiro con un reso aperto, con un reclamo interno aperto: rifiutati
--     (BONIFICO_CAMBIATO) e non resta scritto niente;
--   ② il bonifico vero (contanti 18,00 € meno 2,00 € del ritiro buono = 16,00 €) passa;
--   ③ il secondo clic uguale risponde come il primo; con un altro CRO o un'altra cifra
--     risponde BONIFICO_GIA_SEGNATO col CRO già scritto, e il bonifico resta quello;
--   ④ il ritiro rimborsato in parte (commissione 2,00 €, quota stornata 4,50 €) si regola da
--     solo: compensazione da 0 €, in fattura i 2,00 € di commissione; i 4,50 € di recupero no.
--
-- Senza la correzione della 916 questa prova è ROSSA, e senza la 999i è rosso ④. Tutto in
-- transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2210000-0000-0000-0000-00000000000a', 'fornaio-r22c@test.it', '{"role":"seller"}'),
  ('e2210000-0000-0000-0000-00000000000b', 'mario-r22c@test.it',   '{"role":"buyer"}'),
  ('e2210000-0000-0000-0000-00000000000c', 'anna-r22c@test.it',    '{"role":"buyer"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'e2210000-0000-0000-0000-00000000000a';
UPDATE public.profiles SET role = 'admin', full_name = 'Anna Conti' WHERE id = 'e2210000-0000-0000-0000-00000000000c';

-- c1 contanti da versare; a1 ritiro buono; a2 ritiro con un reso aperto; a3 ritiro con un
-- reclamo interno aperto; a4 ritiro rimborsato in parte (4,50 € di quota del negozio stornata).
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, pickup_in_store,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e2210000-0000-0000-0000-00000000000b', 'e2210000-0000-0000-0000-00000000000a', 20.00, 2000,
       'cod', v.pagamento, 'DELIVERED', v.ritiro,
       'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    ('e2210000-1111-0000-0000-0000000000c1', false, 'PAID'),
    ('e2210000-1111-0000-0000-0000000000a1', true,  'PAID'),
    ('e2210000-1111-0000-0000-0000000000a2', true,  'PAID'),
    ('e2210000-1111-0000-0000-0000000000a3', true,  'PAID'),
    ('e2210000-1111-0000-0000-0000000000a4', true,  'PARTIALLY_REFUNDED')
  ) AS v(id, ritiro, pagamento);

UPDATE public.orders o
   SET payout_status = CASE WHEN o.pickup_in_store THEN 'CASH_IN_STORE' ELSE 'HELD' END,
       seller_payout_cents = 1800, application_fee_cents = 200, delivered_at = '2026-11-18T10:00:00Z',
       internal_dispute_status = CASE WHEN o.id = 'e2210000-1111-0000-0000-0000000000a3'::uuid THEN 'OPEN' END,
       seller_payout_reversed_cents = CASE WHEN o.id = 'e2210000-1111-0000-0000-0000000000a4'::uuid THEN 450 ELSE 0 END
 WHERE o.seller_id = 'e2210000-0000-0000-0000-00000000000a';

INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, created_at)
VALUES ('e2210000-2222-0000-0000-000000000001', 'e2210000-1111-0000-0000-0000000000a2',
        'e2210000-0000-0000-0000-00000000000b', 'e2210000-0000-0000-0000-00000000000a',
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

-- Il bonifico di Pane Quotidiano: c1 più un ritiro, con riferimento e cifra.
CREATE OR REPLACE FUNCTION pg_temp.bonifico(p_ritiro text, p_rif text, p_importo int) RETURNS text
LANGUAGE sql AS $$
  SELECT format($q$SELECT public.segna_bonifico_manuale(
    'e2210000-0000-0000-0000-00000000000a'::uuid,
    ARRAY['e2210000-1111-0000-0000-0000000000c1']::uuid[],
    %L, ARRAY[%L]::uuid[], %s)$q$, p_rif, p_ritiro, p_importo)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.bonifico(text, text, int) TO anon, authenticated, service_role;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2210000-0000-0000-0000-00000000000c","role":"authenticated"}';

-- ① I ritiri fermi non si regolano.
INSERT INTO esiti SELECT 'un ritiro con un reso aperto è rifiutato', r LIKE 'P0001 BONIFICO_CAMBIATO%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2210000-1111-0000-0000-0000000000a2', 'CRO-1', 1600)) AS r;
INSERT INTO esiti SELECT 'un ritiro con un reclamo interno aperto è rifiutato', r LIKE 'P0001 BONIFICO_CAMBIATO%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2210000-1111-0000-0000-0000000000a3', 'CRO-1', 1600)) AS r;
RESET request.jwt.claims;
RESET ROLE;
INSERT INTO esiti
SELECT 'dopo i rifiuti nessun ordine è segnato e nessun bonifico è scritto',
       (SELECT count(*) FROM public.orders WHERE seller_id = 'e2210000-0000-0000-0000-00000000000a' AND payout_at IS NOT NULL) = 0
         AND (SELECT count(*) FROM private.bonifici_manuali WHERE seller_id = 'e2210000-0000-0000-0000-00000000000a') = 0,
       (SELECT count(*) FROM public.orders WHERE seller_id = 'e2210000-0000-0000-0000-00000000000a' AND payout_at IS NOT NULL) || ' ordini segnati';

-- ② Il bonifico vero, col ritiro buono: 18,00 € − 2,00 € = 16,00 €.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2210000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti SELECT 'il bonifico col ritiro buono passa', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2210000-1111-0000-0000-0000000000a1', 'CRO-PRIMO', 1600)) AS r;

-- ③ Il secondo clic.
INSERT INTO esiti SELECT 'il secondo clic uguale risponde come il primo', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2210000-1111-0000-0000-0000000000a1', ' CRO-PRIMO ', 1600)) AS r;
INSERT INTO esiti SELECT 'il secondo clic con un altro CRO dice il CRO già scritto', r LIKE 'P0001 BONIFICO_GIA_SEGNATO%CRO-PRIMO%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2210000-1111-0000-0000-0000000000a1', 'CRO-SECONDO', 1600)) AS r;
INSERT INTO esiti SELECT 'il secondo clic con un''altra cifra non passa', r LIKE 'P0001 BONIFICO_GIA_SEGNATO%CRO-PRIMO%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico('e2210000-1111-0000-0000-0000000000a1', 'CRO-PRIMO', 1800)) AS r;
RESET request.jwt.claims;
RESET ROLE;
INSERT INTO esiti
SELECT 'resta un bonifico solo, col CRO e la cifra del primo',
       count(*) = 1 AND bool_and(b.riferimento = 'CRO-PRIMO' AND b.importo_cents = 1600),
       coalesce(string_agg(format('%s %s', b.riferimento, b.importo_cents), ', '), '(nessuno)')
  FROM private.bonifici_manuali b WHERE b.seller_id = 'e2210000-0000-0000-0000-00000000000a';

-- ④ Il ritiro rimborsato in parte, da solo: 2,00 € + 4,50 € = 6,50 €, senza contanti → compensazione.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2210000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti SELECT 'un ritiro rimborsato in parte si regola con commissione e quota stornata', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale(
    'e2210000-0000-0000-0000-00000000000a'::uuid, '{}'::uuid[], NULL,
    ARRAY['e2210000-1111-0000-0000-0000000000a4']::uuid[], 0)$q$) AS r;
RESET request.jwt.claims;
RESET ROLE;
INSERT INTO esiti
SELECT 'la compensazione del ritiro rimborsato in parte: 2,00 € in fattura, 4,50 € di recupero fuori dalla fattura',
       count(*) = 1
         AND coalesce(bool_and(b.commissione_cents = 200 AND b.recupero_cents = 450 AND b.recupero_trattenuto_cents = 0
                               AND b.trattenuta_cents = 0 AND b.importo_cents = 0 AND b.in_fattura_cents = 200
                               AND b.riferimento IS NULL AND l.cents = 200 AND l.recupero_cents = 0), false)
         AND (SELECT o.payout_at IS NOT NULL FROM public.orders o WHERE o.id = 'e2210000-1111-0000-0000-0000000000a4'),
       coalesce(string_agg(format('commissione %s · recupero %s · trattenuta %s · importo %s · in fattura %s',
                b.commissione_cents, b.recupero_cents, b.trattenuta_cents, b.importo_cents, b.in_fattura_cents), ', '), '(nessun bonifico)')
  FROM private.bonifici_manuali b
  JOIN private.bonifici_manuali_ordini l ON l.bonifico_id = b.id
 WHERE l.order_id = 'e2210000-1111-0000-0000-0000000000a4';

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
    RAISE EXCEPTION E'% controllo/i rosso/i sui cancelli del bonifico fatto:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'i cancelli del bonifico fatto reggono: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
