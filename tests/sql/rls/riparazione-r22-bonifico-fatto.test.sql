-- =============================================================================
-- «Bonifico fatto» ai negozi: resta scritto, con la commissione dei ritiri al banco
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R22 (26/11/2026). Il lunedì Nicola versa a mano ai negozi i contanti della
-- settimana prima, meno la commissione dei ritiri pagati al banco (registro dei
-- fatti: pagamenti.bonifico-contanti-al-negozio, ritiro.in-negozio). Il tasto
-- «Bonifico fatto» chiamava una funzione che nessuna migrazione creava, e il
-- vincolo su payout_status rifiutava PAID_MANUALLY: il bonifico non restava.
--
-- COSA CONTROLLA, con il forno di Pane Quotidiano (tre contanti, un contante
-- con un reso aperto, due ritiri al banco) e un altro negozio:
--   ① cliente, negozio, anonimo e server non segnano niente;
--   ② la funzione è SECURITY DEFINER con search_path fissato, e anon non la esegue;
--   ③ cifra sbagliata, un ordine con un reso aperto, un ordine di un altro negozio,
--     nessun riferimento: rifiutati, e non resta scritto niente;
--   ④ il bonifico vero (31,50 € di contanti meno 3,50 € di commissione = 28,00 €):
--     contanti PAID_MANUALLY con data, ritiro regolato, riga col riferimento e le cifre;
--   ⑤ il secondo clic non riscrive niente e risponde come il primo;
--   ⑥ la compensazione da 0 € (commissione 2,00 € sopra 1,00 € di contanti): senza
--     riferimento, e 1,00 € di commissione resta scritto «in fattura»;
--   ⑦ un ritiro già regolato non entra in un altro bonifico;
--   ⑧ le somme per mese: l'amministratore le legge tutte, il negozio solo le sue;
--   ⑨ le tabelle dei bonifici non si leggono direttamente.
--
-- Senza la migrazione 916 questa prova è ROSSA. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- ------------------------------------------------------------------ personaggi
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2200000-0000-0000-0000-00000000000a', 'fornaio-r22@test.it', '{"role":"seller"}'),
  ('e2200000-0000-0000-0000-00000000000b', 'mario-r22@test.it',   '{"role":"buyer"}'),
  ('e2200000-0000-0000-0000-00000000000c', 'anna-r22@test.it',    '{"role":"buyer"}'),
  ('e2200000-0000-0000-0000-00000000000e', 'altro-r22@test.it',   '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'e2200000-0000-0000-0000-00000000000a';
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Altro Negozio'
 WHERE id = 'e2200000-0000-0000-0000-00000000000e';
UPDATE public.profiles SET role = 'admin', full_name = 'Anna Conti' WHERE id = 'e2200000-0000-0000-0000-00000000000c';

-- Gli ordini: c1, c2 contanti da versare; c3 contanti con un reso aperto; c4 contanti piccoli;
-- r1, r2 ritiri pagati al banco; b1 contanti di un altro negozio.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, pickup_in_store,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e2200000-0000-0000-0000-00000000000b', v.seller::uuid, v.tot, (v.tot * 100)::int,
       'cod', 'PAID', 'DELIVERED', v.ritiro,
       'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    ('e2200000-1111-0000-0000-0000000000c1', 'e2200000-0000-0000-0000-00000000000a', 15.00, false),
    ('e2200000-1111-0000-0000-0000000000c2', 'e2200000-0000-0000-0000-00000000000a', 20.00, false),
    ('e2200000-1111-0000-0000-0000000000c3', 'e2200000-0000-0000-0000-00000000000a', 10.00, false),
    ('e2200000-1111-0000-0000-0000000000c4', 'e2200000-0000-0000-0000-00000000000a',  2.00, false),
    ('e2200000-1111-0000-0000-0000000000a1', 'e2200000-0000-0000-0000-00000000000a', 35.00, true),
    ('e2200000-1111-0000-0000-0000000000a2', 'e2200000-0000-0000-0000-00000000000a', 20.00, true),
    ('e2200000-1111-0000-0000-0000000000b1', 'e2200000-0000-0000-0000-00000000000e', 10.00, false)
  ) AS v(id, seller, tot, ritiro);

UPDATE public.orders o
   SET payout_status = v.stato, seller_payout_cents = v.netto, application_fee_cents = v.fee,
       delivered_at = '2026-11-18T10:00:00Z'
  FROM (VALUES
    ('e2200000-1111-0000-0000-0000000000c1', 'HELD',          1350, 150),
    ('e2200000-1111-0000-0000-0000000000c2', 'HELD',          1800, 200),
    ('e2200000-1111-0000-0000-0000000000c3', 'HELD',           900, 100),
    ('e2200000-1111-0000-0000-0000000000c4', 'HELD',           100,  20),
    ('e2200000-1111-0000-0000-0000000000a1', 'CASH_IN_STORE', 3150, 350),
    ('e2200000-1111-0000-0000-0000000000a2', 'CASH_IN_STORE', 1800, 200),
    ('e2200000-1111-0000-0000-0000000000b1', 'HELD',           900, 100)
  ) AS v(id, stato, netto, fee)
 WHERE o.id = v.id::uuid;

INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, created_at)
VALUES ('e2200000-2222-0000-0000-000000000001', 'e2200000-1111-0000-0000-0000000000c3',
        'e2200000-0000-0000-0000-00000000000b', 'e2200000-0000-0000-0000-00000000000a',
        'DAMAGED', 'REQUESTED', '2026-11-19T09:00:00Z');

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE || CASE WHEN SQLERRM LIKE 'BONIFICO_CAMBIATO%' THEN ' BONIFICO_CAMBIATO' ELSE '' END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.stato(p_id text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(payout_status, '-') || '/' || CASE WHEN payout_at IS NULL THEN 'senza data' ELSE 'con data' END
    FROM public.orders WHERE id = p_id::uuid
$$;

-- Il bonifico vero di Pane Quotidiano: c1 + c2 (31,50 €) e il ritiro a1 (commissione 3,50 €).
CREATE OR REPLACE FUNCTION pg_temp.bonifico_vero(p_importo int, p_rif text) RETURNS text
LANGUAGE sql AS $$
  SELECT format($q$SELECT public.segna_bonifico_manuale(
    'e2200000-0000-0000-0000-00000000000a'::uuid,
    ARRAY['e2200000-1111-0000-0000-0000000000c1', 'e2200000-1111-0000-0000-0000000000c2']::uuid[],
    %L, ARRAY['e2200000-1111-0000-0000-0000000000a1']::uuid[], %s)$q$, p_rif, coalesce(p_importo::text, 'NULL'))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.bonifico_vero(int, text) TO anon, authenticated, service_role;

-- =============================================================================
-- ① Chi non è amministratore non segna niente
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2200000-0000-0000-0000-00000000000b","role":"authenticated"}';
INSERT INTO esiti SELECT 'il cliente non segna un bonifico', r LIKE '42501%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico_vero(2800, 'CRO-1')) AS r;
SET LOCAL request.jwt.claims = '{"sub":"e2200000-0000-0000-0000-00000000000a","role":"authenticated"}';
INSERT INTO esiti SELECT 'il negozio non si segna pagato da solo', r LIKE '42501%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico_vero(2800, 'CRO-1')) AS r;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE anon;
INSERT INTO esiti SELECT 'un anonimo non segna un bonifico', r LIKE '42501%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico_vero(2800, 'CRO-1')) AS r;
RESET ROLE;

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti SELECT 'nemmeno il server: il bonifico lo segna una persona', r LIKE '42501%', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico_vero(2800, 'CRO-1')) AS r;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ② Com'è fatta la funzione
-- =============================================================================
INSERT INTO esiti
SELECT 'SECURITY DEFINER con search_path fissato',
       p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
       format('definer=%s config=%s', p.prosecdef, p.proconfig)
  FROM pg_proc p WHERE p.oid = 'public.segna_bonifico_manuale(uuid, uuid[], text, uuid[], integer)'::regprocedure;
INSERT INTO esiti
SELECT 'anon non ha EXECUTE',
       NOT has_function_privilege('anon', 'public.segna_bonifico_manuale(uuid, uuid[], text, uuid[], integer)', 'EXECUTE'),
       'anon può eseguirla';

-- =============================================================================
-- ③ Anna (amministratrice): i rifiuti non lasciano niente
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2200000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti SELECT 'una cifra diversa da quella vera è rifiutata', r = 'P0001 BONIFICO_CAMBIATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico_vero(3150, 'CRO-1')) AS r;
INSERT INTO esiti SELECT 'un contante con un reso aperto è rifiutato', r = 'P0001 BONIFICO_CAMBIATO', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale('e2200000-0000-0000-0000-00000000000a',
       ARRAY['e2200000-1111-0000-0000-0000000000c1', 'e2200000-1111-0000-0000-0000000000c3']::uuid[], 'CRO-1')$q$) AS r;
INSERT INTO esiti SELECT 'un ordine di un altro negozio è rifiutato', r = 'P0001 BONIFICO_CAMBIATO', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale('e2200000-0000-0000-0000-00000000000a',
       ARRAY['e2200000-1111-0000-0000-0000000000b1']::uuid[], 'CRO-1')$q$) AS r;
INSERT INTO esiti SELECT 'un bonifico vero senza riferimento è rifiutato', r = '22023', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico_vero(2800, '  ')) AS r;
INSERT INTO esiti
SELECT 'dopo i rifiuti gli ordini sono come prima',
       pg_temp.stato('e2200000-1111-0000-0000-0000000000c1') = 'HELD/senza data'
         AND pg_temp.stato('e2200000-1111-0000-0000-0000000000a1') = 'CASH_IN_STORE/senza data',
       pg_temp.stato('e2200000-1111-0000-0000-0000000000c1') || ' · ' || pg_temp.stato('e2200000-1111-0000-0000-0000000000a1');

-- =============================================================================
-- ④ Il bonifico vero: 31,50 € − 3,50 € = 28,00 €
-- =============================================================================
INSERT INTO esiti SELECT 'il bonifico vero passa e dice due contanti segnati', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito(pg_temp.bonifico_vero(2800, ' CRO-0099887766 ')) AS r;
INSERT INTO esiti SELECT 'risponde 2', n = 2, 'risposta: ' || n
  FROM public.segna_bonifico_manuale('e2200000-0000-0000-0000-00000000000a',
       ARRAY['e2200000-1111-0000-0000-0000000000c1', 'e2200000-1111-0000-0000-0000000000c2']::uuid[],
       'CRO-0099887766', ARRAY['e2200000-1111-0000-0000-0000000000a1']::uuid[], 2800) AS n;
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'i contanti sono PAID_MANUALLY con la data, il ritiro resta al banco con la commissione regolata',
       pg_temp.stato('e2200000-1111-0000-0000-0000000000c1') = 'PAID_MANUALLY/con data'
         AND pg_temp.stato('e2200000-1111-0000-0000-0000000000c2') = 'PAID_MANUALLY/con data'
         AND pg_temp.stato('e2200000-1111-0000-0000-0000000000a1') = 'CASH_IN_STORE/con data',
       pg_temp.stato('e2200000-1111-0000-0000-0000000000c1') || ' · ' || pg_temp.stato('e2200000-1111-0000-0000-0000000000c2')
         || ' · ' || pg_temp.stato('e2200000-1111-0000-0000-0000000000a1');
INSERT INTO esiti
SELECT 'la riga del bonifico: 3150 di contanti, 350 trattenuti, 2800 versati, niente in fattura, col riferimento',
       count(*) = 1 AND bool_and(b.contanti_cents = 3150 AND b.commissione_cents = 350 AND b.trattenuta_cents = 350
         AND b.importo_cents = 2800 AND b.in_fattura_cents = 0 AND b.riferimento = 'CRO-0099887766'
         AND b.fatto_da = 'e2200000-0000-0000-0000-00000000000c'),
       coalesce(string_agg(format('%s/%s/%s/%s/%s %s', b.contanti_cents, b.commissione_cents, b.trattenuta_cents,
         b.importo_cents, b.in_fattura_cents, b.riferimento), ', '), '(nessuna riga)')
  FROM private.bonifici_manuali b WHERE b.seller_id = 'e2200000-0000-0000-0000-00000000000a';
INSERT INTO esiti
SELECT 'ogni ordine sta nel bonifico, col suo riferimento',
       count(*) = 3 AND bool_and(b.riferimento = 'CRO-0099887766'),
       count(*) || ' ordini collegati'
  FROM private.bonifici_manuali_ordini l JOIN private.bonifici_manuali b ON b.id = l.bonifico_id;

-- =============================================================================
-- ⑤ Il secondo clic (già fatto sopra con «risponde 2»): nessuna riga in più
-- =============================================================================
INSERT INTO esiti
SELECT 'il secondo clic non scrive un secondo bonifico né un secondo passo nel registro',
       (SELECT count(*) FROM private.bonifici_manuali) = 1
         AND (SELECT count(*) FROM public.audit_logs WHERE action = 'bonifico_manuale_negozio') = 1,
       format('%s bonifici, %s passi', (SELECT count(*) FROM private.bonifici_manuali),
         (SELECT count(*) FROM public.audit_logs WHERE action = 'bonifico_manuale_negozio'));

-- =============================================================================
-- ⑥ La compensazione da 0 €: c4 (1,00 €) contro il ritiro a2 (2,00 €)
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2200000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti SELECT 'la compensazione da 0 € passa senza riferimento', r = 'PASSATO', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale('e2200000-0000-0000-0000-00000000000a',
       ARRAY['e2200000-1111-0000-0000-0000000000c4']::uuid[], NULL,
       ARRAY['e2200000-1111-0000-0000-0000000000a2']::uuid[], 0)$q$) AS r;

-- ⑦ Un ritiro già regolato non entra in un altro bonifico.
INSERT INTO esiti SELECT 'un ritiro già regolato non si trattiene due volte', r = 'P0001 BONIFICO_CAMBIATO', 'risposta: ' || r
  FROM pg_temp.esito($q$SELECT public.segna_bonifico_manuale('e2200000-0000-0000-0000-00000000000a',
       '{}'::uuid[], NULL, ARRAY['e2200000-1111-0000-0000-0000000000a1']::uuid[], 0)$q$) AS r;
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'la compensazione: 0 versati, 1,00 € trattenuto, 1,00 € in fattura, nessun riferimento',
       count(*) = 1 AND bool_and(b.importo_cents = 0 AND b.trattenuta_cents = 100 AND b.in_fattura_cents = 100
         AND b.riferimento IS NULL),
       coalesce(string_agg(format('%s/%s/%s %s', b.importo_cents, b.trattenuta_cents, b.in_fattura_cents,
         coalesce(b.riferimento, 'senza riferimento')), ', '), '(nessuna riga)')
  FROM private.bonifici_manuali b WHERE b.commissione_cents = 200;

-- =============================================================================
-- ⑧ Le somme per mese
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2200000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti
SELECT 'l amministratore legge il mese del forno: 2 bonifici, 28,00 € versati, 4,50 € trattenuti, 1,00 € in fattura',
       count(*) = 1 AND bool_and(m.bonifici = 2 AND m.importo_cents = 2800 AND m.trattenuta_cents = 450 AND m.in_fattura_cents = 100),
       coalesce(string_agg(format('%s %s: %s/%s/%s/%s', m.seller_id, m.mese, m.bonifici, m.importo_cents, m.trattenuta_cents,
         m.in_fattura_cents), ', '), '(niente)')
  FROM public.bonifici_manuali_per_mese() m;
SET LOCAL request.jwt.claims = '{"sub":"e2200000-0000-0000-0000-00000000000a","role":"authenticated"}';
INSERT INTO esiti SELECT 'il forno legge i suoi bonifici', count(*) = 1, count(*) || ' righe'
  FROM public.bonifici_manuali_per_mese() m WHERE m.seller_id = 'e2200000-0000-0000-0000-00000000000a';
SET LOCAL request.jwt.claims = '{"sub":"e2200000-0000-0000-0000-00000000000e","role":"authenticated"}';
INSERT INTO esiti SELECT 'un altro negozio non legge i bonifici del forno', count(*) = 0, count(*) || ' righe'
  FROM public.bonifici_manuali_per_mese() m;

-- ⑨ Le tabelle non si leggono direttamente.
DO $$
DECLARE r text;
BEGIN
  r := pg_temp.esito('SELECT * FROM private.bonifici_manuali');
  INSERT INTO esiti VALUES ('la tabella dei bonifici non si legge direttamente', r = '42501', 'risposta: ' || r);
END $$;
RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE anon;
INSERT INTO esiti SELECT 'un anonimo non legge le somme', r LIKE '42501%', 'risposta: ' || r
  FROM pg_temp.esito('SELECT * FROM public.bonifici_manuali_per_mese()') AS r;
RESET ROLE;

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF (SELECT count(*) FROM esiti) <> 25 THEN
    RAISE EXCEPTION 'la prova doveva fare 25 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sul bonifico fatto ai negozi:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'il bonifico fatto ai negozi resta scritto: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
