-- =============================================================================
-- R18-021 — I permessi del sito sono scritti nelle migrazioni (migrazione 425)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Su un progetto Supabase nuovo le tabelle nascono senza permessi per anon e authenticated:
-- le migrazioni prima della 425 non li concedevano mai, li davano per ereditati. Qui si
-- percorre il sito coi tre ruoli e si pretende che ognuno faccia quello che fa sul sito vero:
-- ① il visitatore legge il catalogo, la vetrina dei negozi e gli eventi, e lascia una visita,
--    un messaggio e una segnalazione;
-- ② il cliente collegato salva un preferito e segna letta una notifica (solo quella colonna);
-- ③ il negozio cambia il prezzo di un suo prodotto;
-- ④ il server (service_role) legge e scrive le sue tabelle;
-- ⑤ nessun permesso ad anon o authenticated su una tabella senza RLS.
-- Su un database costruito senza i permessi di partenza di una volta (l'impalcatura senza
-- ALTER DEFAULT PRIVILEGES … GRANT ALL) i passi ①-④ sono rossi senza la 425.
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e2100000-0000-0000-0000-000000000001', 'negozio-r18p@test.it', '{"role":"seller"}'),
  ('e2100000-0000-0000-0000-000000000002', 'cliente-r18p@test.it', '{"role":"buyer"}');
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = 'e2100000-0000-0000-0000-000000000001';

INSERT INTO public.products (id, name, description, price, seller_id, status, stock)
VALUES ('e2100000-0000-0000-0000-0000000000a1', 'Focaccia di prova', 'cotta al mattino',
        4.50, 'e2100000-0000-0000-0000-000000000001', 'available', 10);
INSERT INTO public.marketplace_events (title, description, starts_at, ends_at)
VALUES ('Mercatino di prova', 'x', now() + interval '1 day', now() + interval '1 day 2 hours');
INSERT INTO public.notifications (id, user_id, title, body)
VALUES ('e2100000-0000-0000-0000-0000000000b1', 'e2100000-0000-0000-0000-000000000002', 'Benvenuto', 'ciao');

RESET mycity.allow_profile_write;

-- ── ① Il visitatore ─────────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';

DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.products WHERE id = 'e2100000-0000-0000-0000-0000000000a1';
    INSERT INTO esiti VALUES ('visitatore: legge il catalogo', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: legge il catalogo', false, SQLERRM); END;
  BEGIN
    SELECT count(*) INTO n FROM public.seller_public_profiles WHERE id = 'e2100000-0000-0000-0000-000000000001';
    INSERT INTO esiti VALUES ('visitatore: legge la vetrina del negozio', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: legge la vetrina del negozio', false, SQLERRM); END;
  BEGIN
    SELECT count(*) INTO n FROM public.categories;
    SELECT count(*) INTO n FROM public.marketplace_events WHERE title = 'Mercatino di prova';
    INSERT INTO esiti VALUES ('visitatore: legge categorie ed eventi', n = 1, n || ' eventi');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: legge categorie ed eventi', false, SQLERRM); END;
  BEGIN
    INSERT INTO public.product_views (product_id) VALUES ('e2100000-0000-0000-0000-0000000000a1');
    INSERT INTO esiti VALUES ('visitatore: lascia la visita a un prodotto', true, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: lascia la visita a un prodotto', false, SQLERRM); END;
  BEGIN
    INSERT INTO public.contact_messages (name, email, message)
    VALUES ('Maria Rossi', 'maria@example.com', 'Vorrei sapere gli orari del mercato.');
    INSERT INTO esiti VALUES ('visitatore: scrive dal modulo contatti', true, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: scrive dal modulo contatti', false, SQLERRM); END;
  BEGIN
    INSERT INTO public.segnalazioni (tipo, oggetto_id, motivo)
    VALUES ('prodotto', 'e2100000-0000-0000-0000-0000000000a1', 'altro');
    INSERT INTO esiti VALUES ('visitatore: segnala un prodotto', true, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('visitatore: segnala un prodotto', false, SQLERRM); END;
  BEGIN
    UPDATE public.products SET price = 0.01 WHERE id = 'e2100000-0000-0000-0000-0000000000a1';
    INSERT INTO esiti VALUES ('visitatore: non cambia un prezzo', false, 'cambiato');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO esiti VALUES ('visitatore: non cambia un prezzo', true, SQLERRM); END;
END $$;

-- ── ② Il cliente collegato ─────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e2100000-0000-0000-0000-000000000002","role":"authenticated"}';

DO $$
DECLARE n int;
BEGIN
  BEGIN
    INSERT INTO public.favorites (user_id, product_id)
    VALUES ('e2100000-0000-0000-0000-000000000002', 'e2100000-0000-0000-0000-0000000000a1');
    INSERT INTO esiti VALUES ('cliente: salva un preferito', true, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('cliente: salva un preferito', false, SQLERRM); END;
  BEGIN
    UPDATE public.notifications SET is_read = true WHERE id = 'e2100000-0000-0000-0000-0000000000b1';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO esiti VALUES ('cliente: segna letta la sua notifica', n = 1, n || ' righe');
  EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('cliente: segna letta la sua notifica', false, SQLERRM); END;
  BEGIN
    UPDATE public.notifications SET title = 'Scritto da me' WHERE id = 'e2100000-0000-0000-0000-0000000000b1';
    INSERT INTO esiti VALUES ('cliente: non riscrive il titolo della notifica', false, 'riscritto');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO esiti VALUES ('cliente: non riscrive il titolo della notifica', true, SQLERRM); END;
END $$;

-- ── ③ Il negozio ───────────────────────────────────────────────────────────
SET LOCAL request.jwt.claims = '{"sub":"e2100000-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE n int;
BEGIN
  UPDATE public.products SET price = 4.80 WHERE id = 'e2100000-0000-0000-0000-0000000000a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO esiti VALUES ('negozio: cambia il prezzo di un suo prodotto', n = 1, n || ' righe');
EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('negozio: cambia il prezzo di un suo prodotto', false, SQLERRM);
END $$;

-- ── ④ Il server ────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.stripe_event_log;
  INSERT INTO public.email_queue (user_id, template, send_at)
  VALUES ('e2100000-0000-0000-0000-000000000002', 'prova', now());
  SELECT count(*) INTO n FROM public.profiles WHERE id = 'e2100000-0000-0000-0000-000000000002';
  INSERT INTO esiti VALUES ('server: legge e scrive le sue tabelle', n = 1, '');
EXCEPTION WHEN OTHERS THEN INSERT INTO esiti VALUES ('server: legge e scrive le sue tabelle', false, SQLERRM);
END $$;

RESET ROLE;

-- ── ⑤ Nessun permesso del browser su una tabella senza RLS ─────────────────
INSERT INTO esiti
SELECT 'nessuna tabella senza RLS aperta ad anon o authenticated', count(*) = 0,
       coalesce(string_agg(c.relname, ', '), 'nessuna')
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
 WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
   AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
        OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'));

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
