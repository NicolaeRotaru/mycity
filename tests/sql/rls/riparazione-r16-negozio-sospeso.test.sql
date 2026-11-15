-- =============================================================================
-- R16-018 (migrazione 400) — Un negozio sospeso non si rimette da solo in coda
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① un negozio sospeso che rimanda il modulo dal browser non torna «in attesa»;
--   ② non cancella la sospensione mettendo lo stato vuoto;
--   ③ in banca dati resta «sospeso»;
--   ④ un negozio rifiutato può ancora ripresentare la richiesta;
--   ⑤ il negozio sospeso cambia ancora il telefono del negozio;
--   ⑥ il server (chiave di servizio) toglie ancora la sospensione.
-- Senza la migrazione 400 ①, ② e ③ sono ROSSI.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e4000000-0000-0000-0000-000000000001', 'sospeso-400@test.it',  '{"role":"seller"}'),
  ('e4000000-0000-0000-0000-000000000002', 'rifiutato-400@test.it', '{"role":"seller"}');
UPDATE public.profiles SET is_approved = false, approval_status = 'suspended', store_name = 'Negozio sospeso 400',
       approval_requested_at = now() - interval '30 days'
 WHERE id = 'e4000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET is_approved = false, approval_status = 'rejected', store_name = 'Negozio rifiutato 400'
 WHERE id = 'e4000000-0000-0000-0000-000000000002';
RESET mycity.allow_profile_write;

-- Il modulo di /sell, se arrivasse al database dal browser: stato «in attesa» e data della richiesta.
CREATE FUNCTION pg_temp.rimanda(utente uuid, stato text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.profiles SET approval_status = stato, approval_requested_at = now() WHERE id = utente;
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.rimanda(uuid, text) TO authenticated;

CREATE FUNCTION pg_temp.telefono(utente uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.profiles SET store_phone = '0523000400' WHERE id = utente;
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.telefono(uuid) TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e4000000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti VALUES ('1 il negozio sospeso non torna in attesa rimandando il modulo',
  NOT pg_temp.rimanda('e4000000-0000-0000-0000-000000000001', 'pending'), '');
INSERT INTO esiti VALUES ('2 il negozio sospeso non cancella la sospensione con lo stato vuoto',
  NOT pg_temp.rimanda('e4000000-0000-0000-0000-000000000001', NULL), '');
INSERT INTO esiti VALUES ('5 il negozio sospeso cambia ancora il telefono del negozio',
  pg_temp.telefono('e4000000-0000-0000-0000-000000000001'), '');
SET LOCAL request.jwt.claims = '{"sub":"e4000000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO esiti VALUES ('4 il negozio rifiutato può ripresentare la richiesta',
  pg_temp.rimanda('e4000000-0000-0000-0000-000000000002', 'pending'), '');
RESET ROLE;

INSERT INTO esiti SELECT '3 in banca dati il negozio è ancora sospeso',
  approval_status IS NOT DISTINCT FROM 'suspended', coalesce(approval_status, '(vuoto)')
  FROM public.profiles WHERE id = 'e4000000-0000-0000-0000-000000000001';

SET LOCAL request.jwt.claims = '{"role":"service_role"}';
INSERT INTO esiti VALUES ('6 il server toglie ancora la sospensione',
  pg_temp.rimanda('e4000000-0000-0000-0000-000000000001', 'pending'), '');

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN RAISE EXCEPTION E'% controllo/i rosso/i sul negozio sospeso:\n  %', rossi, elenco; END IF;
  RAISE NOTICE 'Il negozio sospeso non si rimette in coda da solo: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
