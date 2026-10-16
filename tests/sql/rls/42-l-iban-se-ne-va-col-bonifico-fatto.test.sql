-- =============================================================================
-- L'IBAN se ne va col bonifico fatto, e il browser legge solo l'elenco fisso
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE (riesame del 16/10/2026).
--
-- ① L'IBAN che il cliente lascia per il rimborso restava sul reso per sempre,
--    anche dopo il bonifico. La regola adesso e': si tiene solo finche' il
--    bonifico e' da fare. Il codice lo cancella quando segna «fatto»; qui si
--    prova il paletto della 162 che non dipende dal codice — un «fatto» con
--    l'IBAN (o il nome dell'intestatario) ancora scritto non entra. Lo stesso
--    per i bonifici dei reclami, che adesso hanno anche loro IBAN e nome.
--
-- ② La 162 calcolava al momento le colonne dei resi da dare al browser («tutte
--    tranne l'IBAN»): rieseguita in un ripasso, apriva colonne private nate
--    dopo. Adesso l'elenco e' fisso. Qui si controlla che il browser legga
--    ESATTAMENTE quell'elenco: niente di piu' (ne' l'IBAN ne' il nome
--    dell'intestatario) e niente di meno (la pagina del negozio deve
--    funzionare). Il ripasso vero lo prova
--    tests/sql/harness/la-162-rieseguita-non-apre-colonne.sh.
--
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('ee000000-0000-0000-0000-00000000000a', 'maglie42@test.it', '{"role":"seller"}'),
  ('ee000000-0000-0000-0000-00000000000b', 'giulia42@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Maglieria 42'
 WHERE id = 'ee000000-0000-0000-0000-00000000000a';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, delivered_at, cash_confirmed_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'ee000000-1111-0000-0000-00000000000c',
  'ee000000-0000-0000-0000-00000000000b',
  'ee000000-0000-0000-0000-00000000000a',
  40.00, 4000, 'cod', 'REFUNDED', 'DELIVERED', now() - interval '3 day', now() - interval '3 day',
  'Giulia Bianchi', '3331234567', 'Via Roma 1', 'Piacenza', '29121'
);

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- Il reso rimborsato col bonifico, ancora da fare: IBAN e nome (come dopo la cancellazione
-- dell'account con un bonifico in sospeso).
SET LOCAL ROLE service_role;
INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, refund_method, refund_iban)
VALUES ('ee000000-2222-0000-0000-00000000000d',
        'ee000000-1111-0000-0000-00000000000c',
        'ee000000-0000-0000-0000-00000000000b',
        'ee000000-0000-0000-0000-00000000000a',
        'CHANGED_MIND', 'REQUESTED', 'BONIFICO', 'IT60X0542811101000000123456');
UPDATE public.returns
   SET status = 'REFUNDED', refund_id = 'bonifico:4000:return_ee000000-2222-0000-0000-00000000000d',
       refund_bonifico_cents = 4000, refund_intestatario = 'Giulia Bianchi'
 WHERE id = 'ee000000-2222-0000-0000-00000000000d';
RESET ROLE;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

-- =============================================================================
-- ① IL BROWSER LEGGE L'ELENCO FISSO, NIENTE DI PIU' E NIENTE DI MENO
-- =============================================================================
DO $$
DECLARE
  attese text[] := ARRAY[
    'id', 'order_id', 'order_item_id', 'buyer_id', 'seller_id', 'reason', 'notes', 'photo_urls',
    'status', 'refund_amount_cents', 'refund_id', 'return_label_url', 'tracking_number',
    'created_at', 'decided_at', 'decided_by', 'refunded_at', 'decision_notes',
    'refund_method', 'refund_bonifico_cents', 'refund_bonifico_fatto_at'
  ];
  in_piu text;
  in_meno text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO in_piu
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'returns'
     AND has_column_privilege('authenticated', 'public.returns', column_name, 'SELECT')
     AND column_name <> ALL (attese);
  SELECT string_agg(c, ', ' ORDER BY c) INTO in_meno
    FROM unnest(attese) AS c
   WHERE NOT has_column_privilege('authenticated', 'public.returns', c, 'SELECT');

  INSERT INTO esiti VALUES (
    'il browser non legge nessuna colonna dei resi fuori dall elenco',
    in_piu IS NULL, coalesce('legge anche: ' || in_piu, 'nessuna in piu'));
  INSERT INTO esiti VALUES (
    'il browser legge tutte le colonne dell elenco (la pagina del negozio funziona)',
    in_meno IS NULL, coalesce('non legge: ' || in_meno, 'tutte'));
END $$;

-- Il negozio e la cliente provano a leggere il nome dell'intestatario.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"ee000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    SELECT refund_intestatario FROM public.returns WHERE id = 'ee000000-2222-0000-0000-00000000000d'
  $q$);
  INSERT INTO esiti VALUES ('il negozio non legge il nome dell intestatario del bonifico',
    come <> 'PASSATO', format('esito: %s', come));
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ② FATTO IL BONIFICO, L'IBAN NON RESTA — anche se scrive il server.
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE c1 text; c2 text; c3 text; v_iban text; v_nome text;
BEGIN
  c1 := pg_temp.esito($q$
    UPDATE public.returns SET refund_bonifico_fatto_at = now()
     WHERE id = 'ee000000-2222-0000-0000-00000000000d'
  $q$);
  c2 := pg_temp.esito($q$
    UPDATE public.returns SET refund_bonifico_fatto_at = now(), refund_iban = NULL
     WHERE id = 'ee000000-2222-0000-0000-00000000000d'
  $q$);
  c3 := pg_temp.esito($q$
    UPDATE public.returns SET refund_bonifico_fatto_at = now(), refund_iban = NULL, refund_intestatario = NULL
     WHERE id = 'ee000000-2222-0000-0000-00000000000d'
  $q$);
  SELECT refund_iban, refund_intestatario INTO v_iban, v_nome
    FROM public.returns WHERE id = 'ee000000-2222-0000-0000-00000000000d';
  INSERT INTO esiti VALUES ('un bonifico fatto con l IBAN ancora scritto non entra',
    c1 <> 'PASSATO', format('esito: %s', c1));
  INSERT INTO esiti VALUES ('un bonifico fatto col nome dell intestatario ancora scritto non entra',
    c2 <> 'PASSATO', format('esito: %s', c2));
  INSERT INTO esiti VALUES ('il bonifico fatto che toglie IBAN e nome entra',
    c3 = 'PASSATO' AND v_iban IS NULL AND v_nome IS NULL,
    format('esito: %s, IBAN %s, nome %s', c3, coalesce(v_iban, 'vuoto'), coalesce(v_nome, 'vuoto')));
END $$;
RESET ROLE;

-- =============================================================================
-- ③ IL BONIFICO DEL RECLAMO: IBAN scritto giusto, e via col «fatto».
-- =============================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE c1 text; c2 text; c3 text; c4 text;
BEGIN
  c1 := pg_temp.esito($q$
    INSERT INTO public.bonifici_dei_reclami (dispute_id, order_id, importo_cents, iban)
    VALUES ('ee000000-3333-0000-0000-00000000000e', 'ee000000-1111-0000-0000-00000000000c', 2400, 'it60 x054 2811')
  $q$);
  c2 := pg_temp.esito($q$
    INSERT INTO public.bonifici_dei_reclami (dispute_id, order_id, importo_cents, iban, intestatario)
    VALUES ('ee000000-3333-0000-0000-00000000000e', 'ee000000-1111-0000-0000-00000000000c', 2400,
            'IT60X0542811101000000123456', 'Giulia Bianchi')
  $q$);
  c3 := pg_temp.esito($q$
    UPDATE public.bonifici_dei_reclami SET fatto_at = now()
     WHERE dispute_id = 'ee000000-3333-0000-0000-00000000000e'
  $q$);
  c4 := pg_temp.esito($q$
    UPDATE public.bonifici_dei_reclami SET fatto_at = now(), iban = NULL, intestatario = NULL
     WHERE dispute_id = 'ee000000-3333-0000-0000-00000000000e'
  $q$);
  INSERT INTO esiti VALUES ('un IBAN scritto storto non entra sul bonifico del reclamo',
    c1 <> 'PASSATO', format('esito: %s', c1));
  INSERT INTO esiti VALUES ('il bonifico del reclamo tiene IBAN e nome finche e da fare',
    c2 = 'PASSATO', format('esito: %s', c2));
  INSERT INTO esiti VALUES ('un bonifico del reclamo fatto con l IBAN ancora scritto non entra',
    c3 <> 'PASSATO', format('esito: %s', c3));
  INSERT INTO esiti VALUES ('il bonifico del reclamo fatto che toglie IBAN e nome entra',
    c4 = 'PASSATO', format('esito: %s', c4));
END $$;
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

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sull IBAN che se ne va:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'l IBAN se ne va col bonifico fatto: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
