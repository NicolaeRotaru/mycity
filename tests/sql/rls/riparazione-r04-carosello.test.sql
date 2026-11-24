-- =============================================================================
-- R04-010 (migrazione 662) — Il carosello delle storie legge poche storie PER NEGOZIO
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① tre negozi da 40 storie e dieci negozi da 1-2 storie: TUTTI e 13 i negozi ci sono, e nessun
--      negozio ha più di 30 storie (insieme esatto dei negozi, non «più di uno»);
--   ② 40 negozi da 40 storie: la lettura dà esattamente 30 negozi diversi, e al massimo 30 storie
--      a testa (i 30 posti del carosello sono 30 negozi, prima che uno ne prenda un secondo);
--   ③ non si leggono le storie scadute, né quelle di un negozio sospeso, né di chi non è un negozio;
--   ④ la leggono sia chi ha fatto l'accesso sia chi non l'ha fatto (le storie sono pubbliche);
--   ⑤ i parametri sono limitati: chiedere 1000 storie per negozio non ne dà più di 30;
--   ⑥ la funzione gira coi permessi di chi legge (SECURITY INVOKER) e con search_path fisso.
-- Senza la migrazione 662 la funzione non esiste e ogni controllo è ROSSO.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

CREATE FUNCTION pg_temp.negozio(i integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$ SELECT ('e6620000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.negozio(integer) TO anon, authenticated;

-- 1..40 negozi approvati, 41 sospeso, 42 cliente (non negozio).
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT pg_temp.negozio(i), format('negozio-662-%s@test.it', i), '{"role":"seller"}'::jsonb
  FROM generate_series(1, 42) i;
UPDATE public.profiles SET role = 'seller', is_approved = true, visibile_senza_abbonamento = true, approval_status = 'approved',
       store_name = 'Negozio 662 n.' || right(id::text, 2)
 WHERE id IN (SELECT pg_temp.negozio(i) FROM generate_series(1, 40) i);
UPDATE public.profiles SET role = 'seller', is_approved = false, approval_status = 'suspended', store_name = 'Sospeso 662'
 WHERE id = pg_temp.negozio(41);
UPDATE public.profiles SET role = 'buyer', is_approved = false WHERE id = pg_temp.negozio(42);
RESET mycity.allow_profile_write;

-- `quante` storie di un negozio, la più recente `da_minuti` minuti fa, una al minuto.
CREATE FUNCTION pg_temp.storie(negozio integer, quante integer, da_minuti integer, vive boolean DEFAULT true) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.seller_stories (seller_id, image_url, created_at, expires_at)
  SELECT pg_temp.negozio(negozio), format('https://x/%s-%s.jpg', negozio, k),
         now() - make_interval(mins => da_minuti + k),
         CASE WHEN vive THEN now() + interval '10 hours' ELSE now() - interval '1 hour' END
    FROM generate_series(0, quante - 1) k
$$;

-- Quanti negozi e quante storie al massimo per negozio, fra i negozi di questa prova.
CREATE FUNCTION pg_temp.negozi_letti(per_negozio integer DEFAULT 30, negozi integer DEFAULT 30)
RETURNS TABLE (elenco text, quanti integer, massimo bigint) LANGUAGE sql AS $$
  SELECT coalesce(string_agg(seller_id::text, ',' ORDER BY seller_id::text), ''), count(*)::integer, coalesce(max(n), 0)
    FROM (SELECT seller_id, count(*) AS n
            FROM public.storie_attive_per_negozio(per_negozio, negozi)
           WHERE seller_id::text LIKE 'e6620000-%'
           GROUP BY seller_id) t
$$;
GRANT EXECUTE ON FUNCTION pg_temp.negozi_letti(integer, integer) TO anon, authenticated;

-- ① tre negozi da 40 storie (i più recenti) e dieci da 1-2 storie.
SELECT pg_temp.storie(i, 40, 0) FROM generate_series(1, 3) i;
SELECT pg_temp.storie(i, 1 + (i % 2), 600) FROM generate_series(4, 13) i;
-- Qualche storia che non si deve leggere: scadute, negozio sospeso, cliente.
SELECT pg_temp.storie(14, 5, 700, false);
SELECT pg_temp.storie(41, 5, 0);
SELECT pg_temp.storie(42, 5, 0);

INSERT INTO esiti
SELECT '1 con tre negozi da 40 storie compaiono tutti e 13 i negozi',
       l.elenco = (SELECT string_agg(pg_temp.negozio(i)::text, ',' ORDER BY pg_temp.negozio(i)::text) FROM generate_series(1, 13) i),
       format('%s negozi letti', l.quanti)
  FROM pg_temp.negozi_letti() l;
INSERT INTO esiti
SELECT '1 nessun negozio ha più di 30 storie', l.massimo <= 30, format('massimo %s storie per negozio', l.massimo)
  FROM pg_temp.negozi_letti() l;
INSERT INTO esiti
SELECT '3 non si leggono scadute, sospesi e non-negozi', l.elenco NOT LIKE '%' || pg_temp.negozio(14)::text || '%'
       AND l.elenco NOT LIKE '%' || pg_temp.negozio(41)::text || '%'
       AND l.elenco NOT LIKE '%' || pg_temp.negozio(42)::text || '%',
       format('%s negozi letti', l.quanti)
  FROM pg_temp.negozi_letti() l;
INSERT INTO esiti
SELECT '1 le storie di un negozio escono dalla più recente', (
  SELECT array_agg(created_at ORDER BY created_at DESC) = array_agg(created_at ORDER BY created_at DESC, id)
    FROM public.storie_attive_per_negozio() WHERE seller_id = pg_temp.negozio(1)), 'ordine per data decrescente';

-- ② quaranta negozi da 40 storie.
DELETE FROM public.seller_stories WHERE seller_id::text LIKE 'e6620000-%';
SELECT pg_temp.storie(i, 40, i) FROM generate_series(1, 40) i;
INSERT INTO esiti
SELECT '2 con 40 negozi da 40 storie i posti sono 30 negozi diversi', l.quanti = 30 AND l.massimo <= 30,
       format('%s negozi, massimo %s storie a testa', l.quanti, l.massimo)
  FROM pg_temp.negozi_letti() l;
INSERT INTO esiti
SELECT '2 i 30 negozi sono i 30 con la storia più recente',
       l.elenco = (SELECT string_agg(pg_temp.negozio(i)::text, ',' ORDER BY pg_temp.negozio(i)::text) FROM generate_series(1, 30) i),
       format('%s negozi letti', l.quanti)
  FROM pg_temp.negozi_letti() l;
INSERT INTO esiti
SELECT '5 i parametri sono limitati', l.massimo <= 30 AND l.quanti <= 30, format('%s negozi, massimo %s storie', l.quanti, l.massimo)
  FROM pg_temp.negozi_letti(1000, 1000) l;
INSERT INTO esiti
SELECT '5 una storia a negozio quando se ne chiede una', l.massimo = 1 AND l.quanti = 5, format('%s negozi, massimo %s', l.quanti, l.massimo)
  FROM pg_temp.negozi_letti(1, 5) l;

-- ④ la leggono anche chi ha fatto l'accesso e chi no.
SET LOCAL ROLE anon;
INSERT INTO esiti
SELECT '4 un visitatore senza account la legge', l.quanti = 30, format('%s negozi', l.quanti) FROM pg_temp.negozi_letti() l;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e6620000-0000-0000-0000-000000000042","role":"authenticated"}';
INSERT INTO esiti
SELECT '4 un cliente con account la legge', l.quanti = 30, format('%s negozi', l.quanti) FROM pg_temp.negozi_letti() l;
RESET ROLE;

-- ⑥ permessi di chi legge e search_path fisso.
INSERT INTO esiti
SELECT '6 SECURITY INVOKER e search_path fisso', NOT p.prosecdef AND coalesce(p.proconfig::text, '') LIKE '%search_path=%',
       format('prosecdef=%s config=%s', p.prosecdef, p.proconfig)
  FROM pg_proc p WHERE p.oid = 'public.storie_attive_per_negozio(integer,integer)'::regprocedure;

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN RAISE EXCEPTION E'% controllo/i rosso/i sul carosello delle storie:\n  %', rossi, elenco; END IF;
  RAISE NOTICE 'Il carosello legge poche storie per negozio: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
