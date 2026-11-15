-- =============================================================================
-- R21-012 (13/11/2026) — Gli «Ultimi visti» se ne vanno quando si toglie il
-- consenso ai cookie statistici, qualunque sia la pagina da cui lo si toglie.
-- =============================================================================
-- Ogni scelta sui cookie arriva al server e si scrive in `consent_log`
-- (lib/consent.ts → /api/consent). Qui si scrive la scelta come la scrive la
-- rotta, e si guarda la lista dei prodotti guardati. Transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a2101211-1111-1111-1111-111111111111', 'negozio-r21-012@test.it', '{"role":"seller"}'),
  ('a2101222-2222-2222-2222-222222222222', 'maria-r21-012@test.it',   '{"role":"buyer"}'),
  ('a2101233-3333-3333-3333-333333333333', 'pino-r21-012@test.it',    '{"role":"buyer"}'),
  ('a2101244-4444-4444-4444-444444444444', 'lia-r21-012@test.it',     '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega R21-012'
 WHERE id = 'a2101211-1111-1111-1111-111111111111';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status) VALUES
  ('a2101299-9999-9999-9999-999999999991', 'a2101211-1111-1111-1111-111111111111', 'Pane R21', 'prova', 3.50, 10, 'available'),
  ('a2101299-9999-9999-9999-999999999992', 'a2101211-1111-1111-1111-111111111111', 'Torta R21', 'prova', 9.00, 10, 'available');

RESET mycity.allow_profile_write;

-- Maria, Pino e Lia hanno guardato i due prodotti col consenso acceso.
INSERT INTO public.recently_viewed (user_id, product_id) VALUES
  ('a2101222-2222-2222-2222-222222222222', 'a2101299-9999-9999-9999-999999999991'),
  ('a2101222-2222-2222-2222-222222222222', 'a2101299-9999-9999-9999-999999999992'),
  ('a2101233-3333-3333-3333-333333333333', 'a2101299-9999-9999-9999-999999999991'),
  ('a2101244-4444-4444-4444-444444444444', 'a2101299-9999-9999-9999-999999999991');

-- Maria toglie il consenso ai cookie statistici (la rotta scrive una riga per categoria).
INSERT INTO public.consent_log (user_id, categoria, valore, versione_testo) VALUES
  ('a2101222-2222-2222-2222-222222222222', 'analytics', false, '2'),
  ('a2101222-2222-2222-2222-222222222222', 'marketing', false, '2');
-- Pino conferma il consenso; Lia toglie solo il marketing.
INSERT INTO public.consent_log (user_id, categoria, valore, versione_testo) VALUES
  ('a2101233-3333-3333-3333-333333333333', 'analytics', true, '2'),
  ('a2101244-4444-4444-4444-444444444444', 'analytics', true, '2'),
  ('a2101244-4444-4444-4444-444444444444', 'marketing', false, '2');
-- Un «no» senza account non tocca la lista di nessuno.
INSERT INTO public.consent_log (user_id, anon_id, categoria, valore, versione_testo) VALUES
  (NULL, 'browser-anonimo', 'analytics', false, '2');

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.recently_viewed WHERE user_id = 'a2101222-2222-2222-2222-222222222222';
  INSERT INTO esiti VALUES ('chi toglie il consenso statistico perde subito i suoi «Ultimi visti»', n = 0,
    'righe rimaste a Maria: ' || n);

  SELECT count(*) INTO n FROM public.recently_viewed WHERE user_id = 'a2101233-3333-3333-3333-333333333333';
  INSERT INTO esiti VALUES ('chi conferma il consenso tiene la sua lista', n = 1, 'righe di Pino: ' || n);

  SELECT count(*) INTO n FROM public.recently_viewed WHERE user_id = 'a2101244-4444-4444-4444-444444444444';
  INSERT INTO esiti VALUES ('togliere il solo marketing non cancella gli «Ultimi visti»', n = 1, 'righe di Lia: ' || n);
END $$;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
