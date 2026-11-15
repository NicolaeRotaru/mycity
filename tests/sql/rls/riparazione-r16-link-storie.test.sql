-- =============================================================================
-- R16-011 (migrazione 403) — Il «Scopri di più» di una storia porta solo dentro MyCity
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① un negozio salva una storia col link a una pagina del sito (/promozioni);
--   ② e una storia senza link;
--   ③ non salva una storia col link a un sito esterno (https://…);
--   ④ né con un link che comincia con // (un altro sito travestito);
--   ⑤ né con /\ (che il browser legge come //);
--   ⑥ non cambia il link di una sua storia in un sito esterno.
-- Senza la migrazione 403 ③, ④, ⑤ e ⑥ sono ROSSI.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e4030000-0000-0000-0000-000000000001', 'negozio-403@test.it', '{"role":"seller"}');
UPDATE public.profiles SET role = 'seller', is_approved = true, approval_status = 'approved',
       store_name = 'Negozio delle storie 403'
 WHERE id = 'e4030000-0000-0000-0000-000000000001';
RESET mycity.allow_profile_write;

-- Una storia nuova col link dato: true se il database la accetta, false se la regola la ferma.
CREATE FUNCTION pg_temp.pubblica(link text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.seller_stories (seller_id, image_url, link_url)
  VALUES ('e4030000-0000-0000-0000-000000000001', 'https://x.supabase.co/storage/v1/object/public/stories/a.jpg', link);
  RETURN true;
EXCEPTION WHEN check_violation THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.pubblica(text) TO authenticated;

CREATE FUNCTION pg_temp.cambia_link(link text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.seller_stories SET link_url = link
   WHERE seller_id = 'e4030000-0000-0000-0000-000000000001' AND link_url = '/promozioni';
  RETURN true;
EXCEPTION WHEN check_violation THEN RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.cambia_link(text) TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e4030000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO esiti VALUES ('1 una storia col link a una pagina del sito si salva', pg_temp.pubblica('/promozioni'), '/promozioni');
INSERT INTO esiti VALUES ('2 una storia senza link si salva', pg_temp.pubblica(NULL), 'nessun link');
INSERT INTO esiti VALUES ('3 una storia col link a un sito esterno non si salva',
  NOT pg_temp.pubblica('https://sito-truffa.example/offerta'), 'https://sito-truffa.example/offerta');
INSERT INTO esiti VALUES ('4 un link che comincia con // non si salva',
  NOT pg_temp.pubblica('//sito-truffa.example'), '//sito-truffa.example');
INSERT INTO esiti VALUES ('5 un link che comincia con /\ non si salva',
  NOT pg_temp.pubblica('/\sito-truffa.example'), '/\sito-truffa.example');
INSERT INTO esiti VALUES ('6 il link di una storia salvata non diventa un sito esterno',
  NOT pg_temp.cambia_link('https://sito-truffa.example'), 'https://sito-truffa.example');
RESET ROLE;

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN RAISE EXCEPTION E'% controllo/i rosso/i sul link delle storie:\n  %', rossi, elenco; END IF;
  RAISE NOTICE 'Il link delle storie porta solo dentro MyCity: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
