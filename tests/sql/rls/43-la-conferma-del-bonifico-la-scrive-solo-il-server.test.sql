-- =============================================================================
-- La conferma di un bonifico di rimborso la scrive solo il server
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- PERCHE' ESISTE QUESTO FILE (riesame del 16/10/2026, terzo giro).
--
-- La lista dei bonifici di rimborso da fare (/admin/rimborsi-da-bonificare)
-- prendeva ogni reso «rimborsato» col segno `bonifico:<centesimi>:<chiave>` e
-- lo mostrava a chi paga, con la cifra e l'IBAN scritti sulla riga del reso.
-- In produzione la migrazione 153 non c'e': vale ancora la regola della 024, e
-- il cliente con il suo accesso inserisce da solo una riga di reso intera —
-- stato, segno e IBAN compresi. Mario si scriveva «950 € da bonificare» sul
-- suo conto.
--
-- La cura sta nel codice: un bonifico e' confermato solo se il suo segno sta
-- anche nell'elenco dei rimborsi dell'ORDINE (`orders.stripe_refund_id`), che
-- scrive `refundOrder` (lib/rimborsi/bonifici-da-fare.ts,
-- `bonificoRegistratoSullOrdine`). Questo file prova la gamba del database su
-- cui quella cura si regge, NEL MONDO DI OGGI: senza la 153.
--
-- COSA CONTROLLA. Dentro la transazione si toglie la 153 (le tre righe del suo
-- «REVERSIBILE»), cosi' il database e' quello della produzione. Poi:
--   ① il cliente si scrive davvero la riga finta (la prova misura il mondo giusto);
--   ② il cliente NON riesce a scrivere la conferma sull'ordine;
--   ③ nemmeno il negozio dell'ordine;
--   ④ il server si' — la strada onesta resta aperta.
--
-- Tutto in transazione con ROLLBACK: non lascia dati, e la 153 torna com'era.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- ------------------------------------------------------------------ personaggi
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('dd000000-0000-0000-0000-00000000000a', 'fornaio43@test.it', '{"role":"seller"}'),
  ('dd000000-0000-0000-0000-00000000000b', 'mario43@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'dd000000-0000-0000-0000-00000000000a';

-- L'ordine di Mario: 40 euro in contanti, mai rimborsato.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'dd000000-1111-0000-0000-00000000000d',
  'dd000000-0000-0000-0000-00000000000b',
  'dd000000-0000-0000-0000-00000000000a',
  40.00, 4000, 'cod', 'PENDING', 'NEW',
  'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

-- ------------------------------------------------- il mondo di oggi: niente 153
DROP TRIGGER IF EXISTS trg_returns_coerenti_con_l_ordine ON public.returns;
DROP POLICY IF EXISTS returns_buyer_insert ON public.returns;
CREATE POLICY returns_buyer_insert ON public.returns FOR INSERT WITH CHECK (auth.uid() = buyer_id);
GRANT INSERT ON public.returns TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;

-- =============================================================================
-- ① Mario si scrive la riga finta: senza la 153 il database la lascia entrare.
--    Se questa non passa, la prova non sta guardando il mondo della produzione.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    INSERT INTO public.returns (id, order_id, buyer_id, seller_id, reason, status, refund_amount_cents,
                                refund_id, refund_method, refund_iban, refund_bonifico_cents)
    VALUES ('dd000000-2222-0000-0000-00000000000f',
            'dd000000-1111-0000-0000-00000000000d',
            'dd000000-0000-0000-0000-00000000000b',
            'dd000000-0000-0000-0000-00000000000b',
            'DAMAGED', 'REFUNDED', 95000,
            'bonifico:95000:return_dd000000-2222-0000-0000-00000000000f',
            'BONIFICO', 'IT60X0542811101000000123456', 95000)
  $q$);
  INSERT INTO esiti VALUES (
    'senza la 153 il cliente si scrive da solo il reso rimborsato col bonifico (il mondo della prova e quello vero)',
    come = 'PASSATO',
    CASE WHEN come = 'PASSATO' THEN 'la riga finta e entrata, come in produzione'
         ELSE 'respinto (' || come || '): la prova non sta guardando il mondo senza la 153' END
  );
END $$;
RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- ② Mario prova a scriversi anche la conferma sull'ordine.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
BEGIN
  PERFORM pg_temp.esito($q$
    UPDATE public.orders
       SET stripe_refund_id = 'bonifico:95000:return_dd000000-2222-0000-0000-00000000000f'
     WHERE id = 'dd000000-1111-0000-0000-00000000000d'
  $q$);
END $$;
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'il cliente non si scrive la conferma del bonifico sull ordine',
       stripe_refund_id IS NULL,
       'elenco dei rimborsi sull ordine: ' || coalesce(stripe_refund_id, '(vuoto)')
  FROM public.orders WHERE id = 'dd000000-1111-0000-0000-00000000000d';

-- =============================================================================
-- ③ Nemmeno il negozio dell'ordine la scrive.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-00000000000a","role":"authenticated"}';
DO $$
BEGIN
  PERFORM pg_temp.esito($q$
    UPDATE public.orders
       SET stripe_refund_id = 'bonifico:95000:return_dd000000-2222-0000-0000-00000000000f'
     WHERE id = 'dd000000-1111-0000-0000-00000000000d'
  $q$);
END $$;
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'il negozio non scrive la conferma del bonifico sull ordine',
       stripe_refund_id IS NULL,
       'elenco dei rimborsi sull ordine: ' || coalesce(stripe_refund_id, '(vuoto)')
  FROM public.orders WHERE id = 'dd000000-1111-0000-0000-00000000000d';

-- =============================================================================
-- ④ La strada onesta: il server (chiave di servizio) la scrive.
-- =============================================================================
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE come text;
BEGIN
  come := pg_temp.esito($q$
    UPDATE public.orders
       SET stripe_refund_id = 'bonifico:4000:return_dd000000-3333-0000-0000-000000000001'
     WHERE id = 'dd000000-1111-0000-0000-00000000000d'
  $q$);
  INSERT INTO esiti VALUES ('il server scrive la conferma del bonifico sull ordine', come = 'PASSATO',
                            'scrittura del server: ' || come);
END $$;
RESET request.jwt.claims;
RESET ROLE;

INSERT INTO esiti
SELECT 'la conferma scritta dal server resta sull ordine',
       stripe_refund_id = 'bonifico:4000:return_dd000000-3333-0000-0000-000000000001',
       'elenco dei rimborsi sull ordine: ' || coalesce(stripe_refund_id, '(vuoto)')
  FROM public.orders WHERE id = 'dd000000-1111-0000-0000-00000000000d';

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
    RAISE EXCEPTION E'% controllo/i rosso/i sulla conferma del bonifico:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'la conferma del bonifico la scrive solo il server: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
