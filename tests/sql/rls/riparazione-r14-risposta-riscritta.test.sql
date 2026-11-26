-- =============================================================================
-- R14 · La risposta del negozio svuotata e riscritta non riavvisa il cliente
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: la campanella di chi ha chiesto suonava alla «prima» risposta, e
-- «prima» voleva dire «la risposta di prima era vuota». Il negozio, dall'API
-- (ruolo authenticated, la stessa porta del browser), poteva svuotare la risposta
-- e riscriverla: ogni giro era di nuovo una prima risposta, e il cliente riceveva
-- un avviso in piu' ogni volta.
--
-- Non cerca nomi di trigger o di funzioni: il negozio risponde, svuota, riscrive,
-- e si contano le voci nella campanella del cliente. Senza la correzione e' rossa.
-- Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0141200-0000-0000-0000-00000000000a', 'fornaio-r14r@test.it', '{"role":"seller","full_name":"Mario Fornaio"}'),
  ('e0141200-0000-0000-0000-00000000000b', 'cliente-r14r@test.it', '{"role":"buyer"}'),
  ('e0141200-0000-0000-0000-00000000000c', 'altra-r14r@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane R14r'
 WHERE id = 'e0141200-0000-0000-0000-00000000000a';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('e0141200-1111-0000-0000-000000000001', 'e0141200-0000-0000-0000-00000000000a',
        'Pane casereccio', 'per la prova', 3.50, 10, 'available');

INSERT INTO public.product_questions (id, product_id, author_id, question) VALUES
  ('e0141200-2222-0000-0000-000000000001', 'e0141200-1111-0000-0000-000000000001',
   'e0141200-0000-0000-0000-00000000000b', 'È senza glutine?'),
  ('e0141200-2222-0000-0000-000000000002', 'e0141200-1111-0000-0000-000000000001',
   'e0141200-0000-0000-0000-00000000000c', 'Quanto pesa una pagnotta?');

RESET mycity.allow_profile_write;

-- Aiuto: il negozio scrive la risposta dall'API, col suo account (NULL = la svuota).
CREATE OR REPLACE FUNCTION pg_temp.scrivi(p_domanda uuid, p_testo text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"e0141200-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.product_questions
     SET answer = p_testo,
         answered_at = CASE WHEN p_testo IS NULL THEN NULL ELSE now() END,
         answered_by = 'e0141200-0000-0000-0000-00000000000a'
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

-- ── ① La prima risposta avvisa, come prima ──────────────────────────────────
DO $$
DECLARE e text; n int;
BEGIN
  e := pg_temp.scrivi('e0141200-2222-0000-0000-000000000001', 'Sì, è fatto con farina di riso.');
  n := pg_temp.voci('e0141200-0000-0000-0000-00000000000b');
  INSERT INTO esiti VALUES ('1 la prima risposta arriva a chi ha chiesto',
    e = 'ok' AND n = 1, format('risposta: %s · voci del cliente: %s (attesa 1)', e, n));
END $$;

-- ── ② Svuotata con una stringa vuota e riscritta: nessuna voce in piu' ──────
DO $$
DECLARE e1 text; e2 text; vuota text; n int;
BEGIN
  e1 := pg_temp.scrivi('e0141200-2222-0000-0000-000000000001', '');
  SELECT coalesce(answer, '(null)') INTO vuota FROM public.product_questions WHERE id = 'e0141200-2222-0000-0000-000000000001';
  e2 := pg_temp.scrivi('e0141200-2222-0000-0000-000000000001', 'Sì, farina di riso e mais.');
  n := pg_temp.voci('e0141200-0000-0000-0000-00000000000b');
  INSERT INTO esiti VALUES ('2 svuotata e riscritta dall''API non riavvisa il cliente',
    e1 = 'ok' AND vuota = '' AND e2 = 'ok' AND n = 1,
    format('svuotata: %s (risposta «%s») · riscritta: %s · voci del cliente: %s (attesa 1)', e1, vuota, e2, n));
END $$;

-- ── ③ Svuotata a NULL e riscritta, piu' volte: sempre una voce sola ─────────
DO $$
DECLARE e text; n int; giri int := 0;
BEGIN
  FOR i IN 1..3 LOOP
    e := pg_temp.scrivi('e0141200-2222-0000-0000-000000000001', NULL);
    IF e = 'ok' THEN
      e := pg_temp.scrivi('e0141200-2222-0000-0000-000000000001', format('Risposta riscritta %s.', i));
    END IF;
    IF e = 'ok' THEN giri := giri + 1; END IF;
  END LOOP;
  n := pg_temp.voci('e0141200-0000-0000-0000-00000000000b');
  INSERT INTO esiti VALUES ('3 tre giri di svuota e riscrivi lasciano una voce sola',
    giri = 3 AND n = 1, format('giri riusciti: %s (attesi 3) · voci del cliente: %s (attesa 1)', giri, n));
END $$;

-- ── ④ La domanda di un'altra persona avvisa la sua autrice, una volta ───────
DO $$
DECLARE e text; altra int; cliente int;
BEGIN
  e := pg_temp.scrivi('e0141200-2222-0000-0000-000000000002', 'Mezzo chilo.');
  PERFORM pg_temp.scrivi('e0141200-2222-0000-0000-000000000002', NULL);
  PERFORM pg_temp.scrivi('e0141200-2222-0000-0000-000000000002', 'Mezzo chilo, circa.');
  altra := pg_temp.voci('e0141200-0000-0000-0000-00000000000c');
  cliente := pg_temp.voci('e0141200-0000-0000-0000-00000000000b');
  INSERT INTO esiti VALUES ('4 un''altra domanda avvisa la sua autrice una volta, e non tocca il primo cliente',
    e = 'ok' AND altra = 1 AND cliente = 1,
    format('risposta: %s · voci dell''altra cliente: %s (attesa 1) · voci del primo cliente: %s (attesa 1)', e, altra, cliente));
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R14 risposta riscritta: % controllo/i rosso/i sull''avviso a chi ha chiesto:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R14 risposta riscritta: svuotare e riscrivere la risposta non riavvisa (% controlli verdi)', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
