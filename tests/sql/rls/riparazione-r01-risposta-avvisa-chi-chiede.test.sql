-- =============================================================================
-- R01 · La risposta del negozio a una domanda avvisa chi l'ha fatta
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: quando il negozio rispondeva a una domanda sotto un prodotto
-- (UPDATE di answer su product_questions) l'unico effetto era la riga aggiornata:
-- a chi aveva chiesto non arrivava niente.
--
-- Non cerca nomi di trigger o di funzioni: il cliente chiede, il negozio risponde
-- dal browser (ruolo authenticated) e si guarda la campanella del cliente. Senza
-- la correzione e' rossa. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0101200-0000-0000-0000-00000000000a', 'fornaio-r01r@test.it', '{"role":"seller","full_name":"Mario Fornaio"}'),
  ('e0101200-0000-0000-0000-00000000000b', 'cliente-r01r@test.it', '{"role":"buyer"}'),
  ('e0101200-0000-0000-0000-00000000000c', 'altra-r01r@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane R01r'
 WHERE id = 'e0101200-0000-0000-0000-00000000000a';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('e0101200-1111-0000-0000-000000000001', 'e0101200-0000-0000-0000-00000000000a',
        'Pane casereccio', 'per la prova', 3.50, 10, 'available');

-- Le domande le scrive il database di prova: qui conta la risposta.
INSERT INTO public.product_questions (id, product_id, author_id, question) VALUES
  ('e0101200-2222-0000-0000-000000000001', 'e0101200-1111-0000-0000-000000000001',
   'e0101200-0000-0000-0000-00000000000b', 'È senza glutine?'),
  ('e0101200-2222-0000-0000-000000000002', 'e0101200-1111-0000-0000-000000000001',
   'e0101200-0000-0000-0000-00000000000c', 'Quanto pesa una pagnotta?');

RESET mycity.allow_profile_write;

-- Aiuto: il negozio risponde dal browser, col suo account.
CREATE OR REPLACE FUNCTION pg_temp.rispondi(p_domanda uuid, p_testo text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e0101200-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.product_questions
     SET answer = p_testo, answered_at = now(), answered_by = 'e0101200-0000-0000-0000-00000000000a'
   WHERE id = p_domanda;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN CASE WHEN n = 1 THEN 'ok' ELSE 'righe ' || n END;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.voci(p_chi uuid) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications WHERE user_id = p_chi;
$$;

-- ── ① La risposta del negozio arriva nella campanella di chi ha chiesto ─────
DO $$
DECLARE e text; n int; v record;
BEGIN
  e := pg_temp.rispondi('e0101200-2222-0000-0000-000000000001', 'Sì, è fatto con farina di riso.');
  n := pg_temp.voci('e0101200-0000-0000-0000-00000000000b');
  SELECT * INTO v FROM public.notifications WHERE user_id = 'e0101200-0000-0000-0000-00000000000b' ORDER BY created_at DESC LIMIT 1;
  INSERT INTO esiti VALUES ('1 la risposta arriva a chi ha chiesto',
    e = 'ok' AND n = 1, format('risposta: %s · voci nella campanella del cliente: %s (attesa 1)', e, n));
  INSERT INTO esiti VALUES ('2 la voce porta alla scheda del prodotto, dove si legge la risposta',
    coalesce(v.link, '') = '/product/e0101200-1111-0000-0000-000000000001',
    format('link: %s', coalesce(v.link, '(nessuna voce)')));
  INSERT INTO esiti VALUES ('3 la voce non porta il testo della risposta ne'' chi l''ha scritta',
    v.id IS NOT NULL
      AND (coalesce(v.title, '') || ' ' || coalesce(v.body, '')) !~* '(farina|mario|fornaio-r01r)',
    format('titolo: %s · testo: %s', coalesce(v.title, '-'), coalesce(v.body, '-')));
END $$;

-- ── ② Una risposta corretta dopo non avvisa di nuovo; l'altro cliente non riceve niente
DO $$
DECLARE e text; n int; altra int;
BEGIN
  e := pg_temp.rispondi('e0101200-2222-0000-0000-000000000001', 'Sì, è fatto con farina di riso e mais.');
  n := pg_temp.voci('e0101200-0000-0000-0000-00000000000b');
  altra := pg_temp.voci('e0101200-0000-0000-0000-00000000000c');
  INSERT INTO esiti VALUES ('4 la risposta corretta non fa una seconda campanella, e la domanda di un altro resta muta',
    e = 'ok' AND n = 1 AND altra = 0,
    format('correzione: %s · voci del cliente: %s (attesa 1) · voci dell''altra cliente: %s (attese 0)', e, n, altra));
END $$;

-- ── ③ Ogni domanda risposta avvisa la sua autrice ───────────────────────────
DO $$
DECLARE e text; altra int;
BEGIN
  e := pg_temp.rispondi('e0101200-2222-0000-0000-000000000002', 'Mezzo chilo.');
  altra := pg_temp.voci('e0101200-0000-0000-0000-00000000000c');
  INSERT INTO esiti VALUES ('5 la risposta all''altra domanda avvisa l''altra cliente',
    e = 'ok' AND altra = 1, format('risposta: %s · voci dell''altra cliente: %s (attesa 1)', e, altra));
END $$;

-- ── ④ Il negozio non riceve la voce di chi ha chiesto, e il cliente legge solo la sua
DO $$
DECLARE dal_negozio int; visti int;
BEGIN
  SELECT count(*) INTO dal_negozio FROM public.notifications
   WHERE user_id = 'e0101200-0000-0000-0000-00000000000a' AND title ~* 'risposto';
  PERFORM set_config('request.jwt.claims', '{"sub":"e0101200-0000-0000-0000-00000000000c","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO visti FROM public.notifications WHERE user_id = 'e0101200-0000-0000-0000-00000000000b';
  RESET ROLE;
  INSERT INTO esiti VALUES ('6 chi risponde non avvisa se stesso e un cliente non legge la campanella di un altro',
    dal_negozio = 0 AND visti = 0,
    format('voci «risposto» al negozio: %s (attese 0) · voci altrui viste: %s (attese 0)', dal_negozio, visti));
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R01 risposte: % controllo/i rosso/i sull''avviso a chi ha chiesto:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R01 risposte: la risposta del negozio avvisa chi ha chiesto (% controlli verdi)', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
