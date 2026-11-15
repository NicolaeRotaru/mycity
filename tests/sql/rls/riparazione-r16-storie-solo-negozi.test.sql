-- =============================================================================
-- R16-019 (migrazione 404) — Le storie le scrive solo un negozio approvato
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① un cliente (account senza negozio) non pubblica una storia a proprio nome;
--   ② un negozio sospeso non pubblica una storia;
--   ③ un cliente non allunga la scadenza di una sua storia vecchia;
--   ④ un negozio approvato pubblica una storia;
--   ⑤ un negozio approvato legge le sue storie, anche quelle scadute;
--   ⑥ un negozio sospeso cancella ancora le sue storie;
--   ⑦ nessuno pubblica una storia a nome di un altro.
-- Senza la migrazione 404 ①, ② e ③ sono ROSSI.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e4040000-0000-0000-0000-000000000001', 'cliente-404@test.it',  '{"role":"buyer"}'),
  ('e4040000-0000-0000-0000-000000000002', 'negozio-404@test.it',  '{"role":"seller"}'),
  ('e4040000-0000-0000-0000-000000000003', 'sospeso-404@test.it',  '{"role":"seller"}');
UPDATE public.profiles SET role = 'buyer', is_approved = false
 WHERE id = 'e4040000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'seller', is_approved = true, approval_status = 'approved', store_name = 'Negozio 404'
 WHERE id = 'e4040000-0000-0000-0000-000000000002';
UPDATE public.profiles SET role = 'seller', is_approved = false, approval_status = 'suspended', store_name = 'Sospeso 404'
 WHERE id = 'e4040000-0000-0000-0000-000000000003';
RESET mycity.allow_profile_write;

-- Storie già scritte prima della regola nuova (qui le scrive il proprietario del database).
INSERT INTO public.seller_stories (id, seller_id, image_url, expires_at) VALUES
  ('e4040000-0000-0000-0000-0000000000a1', 'e4040000-0000-0000-0000-000000000001', 'https://x/vecchia-cliente.jpg', now() + interval '2 hours'),
  ('e4040000-0000-0000-0000-0000000000a2', 'e4040000-0000-0000-0000-000000000002', 'https://x/scaduta-negozio.jpg', now() - interval '3 hours'),
  ('e4040000-0000-0000-0000-0000000000a3', 'e4040000-0000-0000-0000-000000000003', 'https://x/vecchia-sospeso.jpg', now() + interval '5 hours');

-- Una storia nuova a nome di `autore`: true se il database la accetta.
CREATE FUNCTION pg_temp.pubblica(autore uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.seller_stories (seller_id, image_url) VALUES (autore, 'https://x/nuova.jpg');
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.pubblica(uuid) TO authenticated;

-- Allunga di un anno la scadenza della storia: true se almeno una riga è cambiata.
CREATE FUNCTION pg_temp.allunga(storia uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE public.seller_stories SET expires_at = now() + interval '365 days' WHERE id = storia;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.allunga(uuid) TO authenticated;

CREATE FUNCTION pg_temp.cancella(storia uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.seller_stories WHERE id = storia;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.cancella(uuid) TO authenticated;

SET LOCAL ROLE authenticated;

SET LOCAL request.jwt.claims = '{"sub":"e4040000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti VALUES ('1 un cliente non pubblica una storia a proprio nome',
  NOT pg_temp.pubblica('e4040000-0000-0000-0000-000000000001'), 'account senza negozio');
INSERT INTO esiti VALUES ('3 un cliente non allunga la scadenza di una sua storia vecchia',
  NOT pg_temp.allunga('e4040000-0000-0000-0000-0000000000a1'), 'scadenza spostata di un anno');
INSERT INTO esiti VALUES ('7 un cliente non pubblica una storia a nome di un negozio',
  NOT pg_temp.pubblica('e4040000-0000-0000-0000-000000000002'), 'seller_id di un altro');

SET LOCAL request.jwt.claims = '{"sub":"e4040000-0000-0000-0000-000000000003","role":"authenticated"}';
INSERT INTO esiti VALUES ('2 un negozio sospeso non pubblica una storia',
  NOT pg_temp.pubblica('e4040000-0000-0000-0000-000000000003'), 'negozio sospeso');
INSERT INTO esiti VALUES ('6 un negozio sospeso cancella ancora le sue storie',
  pg_temp.cancella('e4040000-0000-0000-0000-0000000000a3'), 'la sua storia vecchia');

SET LOCAL request.jwt.claims = '{"sub":"e4040000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti VALUES ('4 un negozio approvato pubblica una storia',
  pg_temp.pubblica('e4040000-0000-0000-0000-000000000002'), 'negozio approvato');
INSERT INTO esiti SELECT '5 un negozio approvato legge le sue storie, anche le scadute', count(*) = 2,
  format('%s storie lette su 2', count(*))
  FROM public.seller_stories WHERE seller_id = 'e4040000-0000-0000-0000-000000000002';

RESET ROLE;

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN RAISE EXCEPTION E'% controllo/i rosso/i su chi scrive le storie:\n  %', rossi, elenco; END IF;
  RAISE NOTICE 'Le storie le scrive solo un negozio approvato: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
