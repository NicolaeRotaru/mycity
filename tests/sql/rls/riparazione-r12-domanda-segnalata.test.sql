-- =============================================================================
-- R12-021 — Una domanda sotto un prodotto si segnala e l'amministratore la nasconde
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--   ① una segnalazione di tipo «domanda» si registra;
--   ② l'amministratore nasconde la domanda (is_public = false) e la vede ancora;
--   ③ un cliente qualunque non la nasconde;
--   ④ nascosta, il pubblico non la legge piu'.
-- Senza la migrazione 364 ① e ② sono ROSSI.
-- =============================================================================

BEGIN;
SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1210000-0000-0000-0000-000000000001', 'negozio-r12q@test.it', '{"role":"seller"}'),
  ('e1210000-0000-0000-0000-000000000002', 'autore-r12q@test.it',  '{"role":"buyer"}'),
  ('e1210000-0000-0000-0000-000000000003', 'altro-r12q@test.it',   '{"role":"buyer"}'),
  ('e1210000-0000-0000-0000-000000000004', 'capo-r12q@test.it',    '{"role":"admin"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Negozio R12q'
 WHERE id = 'e1210000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'admin' WHERE id = 'e1210000-0000-0000-0000-000000000004';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('e1210000-0000-0000-0000-0000000000b1', 'e1210000-0000-0000-0000-000000000001', 'Vaso R12', 'x', 10, 3, 'available');
INSERT INTO public.product_questions (id, product_id, author_id, question)
VALUES ('e1210000-0000-0000-0000-0000000000d1', 'e1210000-0000-0000-0000-0000000000b1',
        'e1210000-0000-0000-0000-000000000002', 'Chiamami al 3331234567, idiota');

-- ① segnalazione di tipo domanda
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.segnalazioni (tipo, oggetto_id, motivo, dettaglio)
    VALUES ('domanda', 'e1210000-0000-0000-0000-0000000000d1', 'odio_o_molestie', 'insulto e telefono');
    ok := true;
  EXCEPTION WHEN check_violation THEN ok := false;
  END;
  INSERT INTO esiti VALUES ('1 una domanda si segnala', ok, '');
END $$;

-- ③ un altro cliente prova a nasconderla
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1210000-0000-0000-0000-000000000003","role":"authenticated"}';
UPDATE public.product_questions SET is_public = false WHERE id = 'e1210000-0000-0000-0000-0000000000d1';
RESET ROLE;
INSERT INTO esiti SELECT '3 un cliente qualunque non la nasconde', is_public, is_public::text
  FROM public.product_questions WHERE id = 'e1210000-0000-0000-0000-0000000000d1';

-- ② l'amministratore la nasconde e la vede ancora
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1210000-0000-0000-0000-000000000004","role":"authenticated"}';
UPDATE public.product_questions SET is_public = false WHERE id = 'e1210000-0000-0000-0000-0000000000d1';
INSERT INTO esiti SELECT '2b nascosta, l amministratore la vede ancora', count(*) = 1, count(*)::text
  FROM public.product_questions WHERE id = 'e1210000-0000-0000-0000-0000000000d1';
RESET ROLE;
INSERT INTO esiti SELECT '2 l amministratore la nasconde', NOT is_public, is_public::text
  FROM public.product_questions WHERE id = 'e1210000-0000-0000-0000-0000000000d1';

-- ④ il pubblico non la legge più
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
INSERT INTO esiti SELECT '4 nascosta, il pubblico non la legge', count(*) = 0, count(*)::text
  FROM public.product_questions WHERE id = 'e1210000-0000-0000-0000-0000000000d1';
RESET ROLE;

-- ⑤ (collaudo K03) un cliente non inserisce una domanda con una «risposta del negozio» già scritta
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1210000-0000-0000-0000-000000000003","role":"authenticated"}';
DO $$
DECLARE passata boolean;
BEGIN
  BEGIN
    INSERT INTO public.product_questions (product_id, author_id, question, answer, answered_by, answered_at)
    VALUES ('e1210000-0000-0000-0000-0000000000b1', 'e1210000-0000-0000-0000-000000000003',
            'È buono?', 'Sì, il migliore della città!', 'e1210000-0000-0000-0000-000000000001', now());
    passata := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN passata := false;
  END;
  INSERT INTO esiti VALUES ('5 una domanda non nasce con una risposta finta del negozio', NOT passata, '');
  BEGIN
    INSERT INTO public.product_questions (product_id, author_id, question)
    VALUES ('e1210000-0000-0000-0000-0000000000b1', 'e1210000-0000-0000-0000-000000000003', 'Quanto pesa?');
    passata := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN passata := false;
  END;
  INSERT INTO esiti VALUES ('5b una domanda normale si fa ancora', passata, '');
END $$;
RESET ROLE;

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco FROM esiti e WHERE e.ok IS NOT TRUE;
  IF rossi > 0 THEN RAISE EXCEPTION E'% controllo/i rosso/i sulle domande:\n  %', rossi, elenco; END IF;
  RAISE NOTICE 'una domanda si segnala e si nasconde: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;
ROLLBACK;
