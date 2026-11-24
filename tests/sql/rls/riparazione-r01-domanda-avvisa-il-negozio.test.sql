-- =============================================================================
-- R01 · Una domanda nuova sotto un prodotto avvisa il negozio
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: una domanda sotto un prodotto (product_questions, 027) era solo una
-- riga. Nessuna notifica al negozio: la scopriva solo aprendo da se' la scheda.
--
-- Non cerca nomi di trigger o di funzioni: il cliente fa una domanda dal browser
-- (ruolo authenticated) e si guarda la campanella del negozio. Senza la
-- correzione e' rossa. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0101300-0000-0000-0000-00000000000a', 'fornaio-r01q@test.it', '{"role":"seller","full_name":"Fornaio Prova"}'),
  ('e0101300-0000-0000-0000-00000000000b', 'cliente-r01q@test.it', '{"role":"buyer","full_name":"Giulia Bianchi"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane R01q'
 WHERE id = 'e0101300-0000-0000-0000-00000000000a';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('e0101300-1111-0000-0000-000000000001', 'e0101300-0000-0000-0000-00000000000a',
        'Pane casereccio', 'per la prova', 3.50, 10, 'available'),
       ('e0101300-1111-0000-0000-000000000002', 'e0101300-0000-0000-0000-00000000000a',
        'Focaccia', 'per la prova', 2.50, 10, 'available');

RESET mycity.allow_profile_write;

-- Aiuto: la persona fa una domanda dal browser, col suo account.
CREATE OR REPLACE FUNCTION pg_temp.chiedi(p_chi uuid, p_prodotto uuid, p_testo text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_chi, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.product_questions (product_id, author_id, question) VALUES (p_prodotto, p_chi, p_testo);
  RESET ROLE;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.voci_negozio() RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications WHERE user_id = 'e0101300-0000-0000-0000-00000000000a';
$$;

-- ── ① La domanda del cliente arriva nella campanella del negozio ────────────
DO $$
DECLARE e text; n int; v record;
BEGIN
  e := pg_temp.chiedi('e0101300-0000-0000-0000-00000000000b', 'e0101300-1111-0000-0000-000000000001',
                      'È senza glutine? Mi chiamo Giulia, tel 3331234567');
  n := pg_temp.voci_negozio();
  SELECT * INTO v FROM public.notifications WHERE user_id = 'e0101300-0000-0000-0000-00000000000a' ORDER BY created_at DESC LIMIT 1;
  INSERT INTO esiti VALUES ('1 la domanda del cliente arriva al negozio',
    e = 'ok' AND n = 1,
    format('domanda: %s · voci nella campanella del negozio: %s (attesa 1)', e, n));
  INSERT INTO esiti VALUES ('2 la voce porta alla scheda del prodotto, dove si risponde',
    coalesce(v.link, '') = '/product/e0101300-1111-0000-0000-000000000001',
    format('link: %s', coalesce(v.link, '(nessuna voce)')));
  INSERT INTO esiti VALUES ('3 la voce non porta i dati del cliente',
    v.id IS NOT NULL
      AND (coalesce(v.title, '') || ' ' || coalesce(v.body, '')) !~* '(giulia|bianchi|cliente-r01q|3331234567|glutine)',
    format('titolo: %s · testo: %s', coalesce(v.title, '-'), coalesce(v.body, '-')));
END $$;

-- ── ② Una seconda domanda sullo stesso prodotto, con la voce non letta, non ne aggiunge un'altra
DO $$
DECLARE e text; n int;
BEGIN
  e := pg_temp.chiedi('e0101300-0000-0000-0000-00000000000b', 'e0101300-1111-0000-0000-000000000001',
                      'E quanto pesa una pagnotta?');
  n := pg_temp.voci_negozio();
  INSERT INTO esiti VALUES ('4 con la voce non letta, la seconda domanda non fa una seconda campanella',
    e = 'ok' AND n = 1, format('domanda: %s · voci: %s (attesa 1)', e, n));
END $$;

-- ── ③ Letta la voce, la domanda dopo avvisa di nuovo; un altro prodotto avvisa a parte
UPDATE public.notifications SET is_read = true WHERE user_id = 'e0101300-0000-0000-0000-00000000000a';
DO $$
DECLARE e1 text; e2 text; n int;
BEGIN
  e1 := pg_temp.chiedi('e0101300-0000-0000-0000-00000000000b', 'e0101300-1111-0000-0000-000000000001',
                       'Lo fate anche il sabato?');
  e2 := pg_temp.chiedi('e0101300-0000-0000-0000-00000000000b', 'e0101300-1111-0000-0000-000000000002',
                       'La focaccia è con olio di oliva?');
  n := pg_temp.voci_negozio();
  INSERT INTO esiti VALUES ('5 letta la voce, una domanda nuova avvisa di nuovo, e ogni prodotto ha la sua',
    e1 = 'ok' AND e2 = 'ok' AND n = 3, format('domande: %s, %s · voci: %s (attese 3)', e1, e2, n));
END $$;

-- ── ④ Il negozio che chiede sul suo prodotto non avvisa se stesso; il cliente non riceve niente
UPDATE public.notifications SET is_read = true WHERE user_id = 'e0101300-0000-0000-0000-00000000000a';
DO $$
DECLARE e text; n int; nc int;
BEGIN
  e := pg_temp.chiedi('e0101300-0000-0000-0000-00000000000a', 'e0101300-1111-0000-0000-000000000002',
                      'Prova del negozio sul suo prodotto');
  n := pg_temp.voci_negozio();
  SELECT count(*) INTO nc FROM public.notifications WHERE user_id = 'e0101300-0000-0000-0000-00000000000b';
  INSERT INTO esiti VALUES ('6 il negozio non avvisa se stesso e chi chiede non riceve la voce del negozio',
    e = 'ok' AND n = 3 AND nc = 0, format('domanda: %s · voci del negozio: %s (attese 3) · voci del cliente: %s (attese 0)', e, n, nc));
END $$;

-- ── ⑤ La voce la legge solo il negozio: il cliente dal browser non la vede ──
DO $$
DECLARE visti int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e0101300-0000-0000-0000-00000000000b","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO visti FROM public.notifications WHERE user_id = 'e0101300-0000-0000-0000-00000000000a';
  RESET ROLE;
  INSERT INTO esiti VALUES ('7 il cliente non legge la campanella del negozio',
    visti = 0, format('voci del negozio viste dal cliente: %s (attese 0)', visti));
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R01 domande: % controllo/i rosso/i sull''avviso al negozio:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R01 domande: la domanda nuova avvisa il negozio (% controlli verdi)', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
