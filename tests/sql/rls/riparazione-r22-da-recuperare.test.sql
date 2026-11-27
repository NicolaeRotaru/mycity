-- =============================================================================
-- Contanti versati a mano e poi rimborsati: la quota da riprendere dal negozio si vede
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- R22 (26/11/2026, giro di correzione). Un reso entro 14 giorni arriva spesso dopo il
-- bonifico del lunedì: l'ordine è già PAID_MANUALLY, il rimborso al cliente esce, e la
-- quota del negozio si scriveva come se si togliesse da un bonifico futuro che non c'è
-- più (o l'ordine passava a REFUNDED). I soldi restavano al negozio e nessuno lo vedeva.
-- contanti_da_recuperare (916) dice, solo all'amministratore, quanto va ripreso.
--
-- COSA CONTROLLA:
--   ① un rimborso parziale dopo il bonifico: da riprendere la quota stornata;
--   ② un rimborso pieno (REFUNDED sopra PAID_MANUALLY): da riprendere tutto il versato;
--   ③ un contante pagato e mai rimborsato non compare;
--   ④ il negozio e l'anonimo non la leggono; è SECURITY DEFINER con search_path fissato.
--
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2220000-0000-0000-0000-00000000000a', 'fornaio-r22r@test.it', '{"role":"seller"}'),
  ('e2220000-0000-0000-0000-00000000000b', 'mario-r22r@test.it',   '{"role":"buyer"}'),
  ('e2220000-0000-0000-0000-00000000000c', 'anna-r22r@test.it',    '{"role":"buyer"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano'
 WHERE id = 'e2220000-0000-0000-0000-00000000000a';
UPDATE public.profiles SET role = 'admin', full_name = 'Anna Conti' WHERE id = 'e2220000-0000-0000-0000-00000000000c';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status, pickup_in_store,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid, 'e2220000-0000-0000-0000-00000000000b', 'e2220000-0000-0000-0000-00000000000a', 20.00, 2000,
       'cod', 'PAID', 'DELIVERED', false,
       'Mario Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
  FROM (VALUES
    ('e2220000-1111-0000-0000-0000000000c1'),
    ('e2220000-1111-0000-0000-0000000000c2'),
    ('e2220000-1111-0000-0000-0000000000c3')
  ) AS v(id);
UPDATE public.orders
   SET payout_status = 'HELD', seller_payout_cents = 1800, application_fee_cents = 200,
       delivered_at = '2026-11-18T10:00:00Z'
 WHERE seller_id = 'e2220000-0000-0000-0000-00000000000a';

RESET mycity.allow_profile_write;
RESET mycity.allow_order_write;

CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASSATO';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.esito(text) TO anon, authenticated, service_role;

-- Il lunedì: Anna segna il bonifico dei tre contanti (54,00 €).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2220000-0000-0000-0000-00000000000c","role":"authenticated"}';
SELECT public.segna_bonifico_manuale('e2220000-0000-0000-0000-00000000000a',
  ARRAY['e2220000-1111-0000-0000-0000000000c1', 'e2220000-1111-0000-0000-0000000000c2',
        'e2220000-1111-0000-0000-0000000000c3']::uuid[], 'CRO-LUNEDI', '{}'::uuid[], 5400);
RESET request.jwt.claims;
RESET ROLE;

-- Poi i resi: c1 rimborsato in parte (quota stornata 4,50 €), c2 rimborsato per intero
-- (come scrive oggi il rimborso: REFUNDED sopra PAID_MANUALLY, quota tutta stornata).
SET LOCAL mycity.allow_order_write = '1';
UPDATE public.orders SET payment_status = 'PARTIALLY_REFUNDED', seller_payout_reversed_cents = 450
 WHERE id = 'e2220000-1111-0000-0000-0000000000c1';
UPDATE public.orders SET payment_status = 'REFUNDED', payout_status = 'REFUNDED', seller_payout_reversed_cents = 1800
 WHERE id = 'e2220000-1111-0000-0000-0000000000c2';
RESET mycity.allow_order_write;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2220000-0000-0000-0000-00000000000c","role":"authenticated"}';
INSERT INTO esiti
SELECT 'rimborso parziale dopo il bonifico: 4,50 € da riprendere',
       count(*) = 1 AND bool_and(d.da_recuperare_cents = 450 AND d.versato_cents = 1800 AND d.riferimento = 'CRO-LUNEDI'
         AND d.store_name = 'Pane Quotidiano' AND d.seller_id = 'e2220000-0000-0000-0000-00000000000a'),
       coalesce(string_agg(format('%s/%s %s', d.versato_cents, d.da_recuperare_cents, d.riferimento), ', '), '(niente)')
  FROM public.contanti_da_recuperare() d WHERE d.order_id = 'e2220000-1111-0000-0000-0000000000c1';
INSERT INTO esiti
SELECT 'rimborso pieno dopo il bonifico: 18,00 € da riprendere',
       count(*) = 1 AND bool_and(d.da_recuperare_cents = 1800),
       coalesce(string_agg(d.da_recuperare_cents::text, ', '), '(niente)')
  FROM public.contanti_da_recuperare() d WHERE d.order_id = 'e2220000-1111-0000-0000-0000000000c2';
INSERT INTO esiti
SELECT 'un contante pagato e mai rimborsato non compare', count(*) = 0, count(*) || ' righe'
  FROM public.contanti_da_recuperare() d WHERE d.order_id = 'e2220000-1111-0000-0000-0000000000c3';
SET LOCAL request.jwt.claims = '{"sub":"e2220000-0000-0000-0000-00000000000a","role":"authenticated"}';
INSERT INTO esiti SELECT 'il negozio non la legge', r = '42501', 'risposta: ' || r
  FROM pg_temp.esito('SELECT * FROM public.contanti_da_recuperare()') AS r;
RESET request.jwt.claims;
RESET ROLE;
SET LOCAL ROLE anon;
INSERT INTO esiti SELECT 'un anonimo non la legge', r = '42501', 'risposta: ' || r
  FROM pg_temp.esito('SELECT * FROM public.contanti_da_recuperare()') AS r;
RESET ROLE;
INSERT INTO esiti
SELECT 'SECURITY DEFINER con search_path fissato',
       p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
       format('definer=%s config=%s', p.prosecdef, p.proconfig)
  FROM pg_proc p WHERE p.oid = 'public.contanti_da_recuperare()'::regprocedure;

-- ── Verdetto ──────────────────────────────────────────────────────────────
SELECT nome, CASE WHEN verde THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio
  FROM esiti ORDER BY nome;

DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;

  IF (SELECT count(*) FROM esiti) <> 6 THEN
    RAISE EXCEPTION 'la prova doveva fare 6 controlli e ne ha fatti %', (SELECT count(*) FROM esiti);
  END IF;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i sulle quote da recuperare:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'le quote da recuperare si vedono: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
