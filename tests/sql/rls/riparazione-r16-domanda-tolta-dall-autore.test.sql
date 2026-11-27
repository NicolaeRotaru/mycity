-- =============================================================================
-- R16-009 — Chi ha fatto una domanda sotto un prodotto la toglie; nessun altro
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① l'autore cancella la sua domanda;
--   ② un altro cliente non la cancella;
--   ③ il negozio del prodotto non la cancella;
--   ④ un visitatore senza account non la cancella;
--   ⑤ una domanda che l'amministratore ha nascosto resta, anche per l'autore.
-- Senza la migrazione 970 ① e' ROSSO.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1690000-0000-0000-0000-000000000001', 'negozio-r16q@test.it', '{"role":"seller"}'),
  ('e1690000-0000-0000-0000-000000000002', 'autore-r16q@test.it',  '{"role":"buyer"}'),
  ('e1690000-0000-0000-0000-000000000003', 'altro-r16q@test.it',   '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Negozio R16q'
 WHERE id = 'e1690000-0000-0000-0000-000000000001';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('e1690000-0000-0000-0000-0000000000b1', 'e1690000-0000-0000-0000-000000000001', 'Vaso R16', 'x', 10, 3, 'available');
INSERT INTO public.product_questions (id, product_id, author_id, question, is_public) VALUES
  ('e1690000-0000-0000-0000-0000000000d1', 'e1690000-0000-0000-0000-0000000000b1',
   'e1690000-0000-0000-0000-000000000002', 'Chiamatemi al 3331234567, grazie', true),
  ('e1690000-0000-0000-0000-0000000000d2', 'e1690000-0000-0000-0000-0000000000b1',
   'e1690000-0000-0000-0000-000000000002', 'Domanda nascosta dall amministratore', false);

-- Prova a cancellare la domanda come chi e' impostato adesso: un rifiuto di permesso conta come «non cancellata».
CREATE TEMP TABLE tentativi (chi text, rifiutato boolean) ON COMMIT DROP;
GRANT ALL ON tentativi TO anon, authenticated;

-- ② un altro cliente
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1690000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$ BEGIN
  DELETE FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d1';
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO tentativi VALUES ('altro', true);
END $$;
RESET ROLE;
INSERT INTO esiti SELECT '2 un altro cliente non la cancella', count(*) = 1, count(*)::text
  FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d1';

-- ③ il negozio del prodotto
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1690000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$ BEGIN
  DELETE FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d1';
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO tentativi VALUES ('negozio', true);
END $$;
RESET ROLE;
INSERT INTO esiti SELECT '3 il negozio non la cancella', count(*) = 1, count(*)::text
  FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d1';

-- ④ un visitatore senza account
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
DO $$ BEGIN
  DELETE FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d1';
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO tentativi VALUES ('visitatore', true);
END $$;
RESET ROLE;
INSERT INTO esiti SELECT '4 un visitatore non la cancella', count(*) = 1, count(*)::text
  FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d1';

-- ⑤ e ① l'autore: la nascosta resta, la sua pubblica va via
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1690000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$ BEGIN
  DELETE FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d2';
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO tentativi VALUES ('autore-nascosta', true);
END $$;
DO $$ BEGIN
  DELETE FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d1';
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO tentativi VALUES ('autore', true);
END $$;
RESET ROLE;
INSERT INTO esiti SELECT '5 la domanda nascosta dall amministratore resta', count(*) = 1, count(*)::text
  FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d2';
INSERT INTO esiti SELECT '1 l autore cancella la sua domanda', count(*) = 0,
       count(*)::text || ' righe rimaste' || CASE WHEN EXISTS (SELECT 1 FROM tentativi WHERE chi = 'autore')
                                                  THEN ', permesso rifiutato' ELSE '' END
  FROM public.product_questions WHERE id = 'e1690000-0000-0000-0000-0000000000d1';

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN RAISE EXCEPTION E'% controllo/i rosso/i sulle domande tolte:\n  %', rossi, elenco; END IF;
  RAISE NOTICE 'chi ha fatto la domanda la toglie, nessun altro: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
