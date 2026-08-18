-- =============================================================================
-- Visite ai prodotti — quante se ne possono scrivere dal browser
-- =============================================================================
-- Con quelle visite si costruiscono i «più visti» della home e le statistiche
-- del negoziante. Prima le visite anonime non avevano nessun tetto: un ciclo di
-- richieste con la chiave pubblica del browser gonfiava un prodotto a piacere.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('91111111-1111-1111-1111-111111111111', 'negozio3@test.it', '{"role":"seller"}'),
  ('93333333-3333-3333-3333-333333333333', 'cliente3@test.it',  '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega tre'
 WHERE id = '91111111-1111-1111-1111-111111111111';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('99999999-9999-9999-9999-999999999999',
        '91111111-1111-1111-1111-111111111111',
        'Pane di prova', 'per i test', 3.50, 100, 'available');

RESET mycity.allow_profile_write;

-- =============================================================================
-- 1. Un ciclo di visite anonime non gonfia il prodotto oltre il tetto
-- =============================================================================
-- Duecento tentativi come visitatore senza account.
SET LOCAL ROLE anon;
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..200 LOOP
    BEGIN
      INSERT INTO public.product_views (product_id, user_id)
      VALUES ('99999999-9999-9999-9999-999999999999', NULL);
    EXCEPTION WHEN others THEN NULL;   -- un rifiuto va benissimo
    END;
  END LOOP;
END $$;
RESET ROLE;

-- Il conteggio va fatto da un ruolo che PUÒ leggere: `anon` non ha nessuna
-- policy di lettura su product_views, quindi contando da lì il risultato
-- sarebbe zero comunque — e il controllo passerebbe senza provare niente.
DO $$
DECLARE scritte int;
BEGIN
  SELECT count(*) INTO scritte FROM public.product_views
   WHERE product_id = '99999999-9999-9999-9999-999999999999' AND user_id IS NULL;
  -- 200 tentativi, il tetto è 20 al minuto: devono passarne fra 1 e 20.
  INSERT INTO esiti VALUES ('le visite anonime hanno un tetto',
    scritte > 0 AND scritte <= 20,
    'su 200 tentativi ne sono state scritte ' || scritte);
END $$;

-- =============================================================================
-- 2. Ma una visita anonima normale passa
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE errore text := '';
BEGIN
  BEGIN
    INSERT INTO public.product_views (product_id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999999', NULL);
  EXCEPTION WHEN others THEN errore := SQLSTATE || ': ' || SQLERRM;
  END;
  -- Il tetto è già stato raggiunto sopra: la visita in eccesso si scarta in
  -- silenzio, senza far scoppiare la pagina del prodotto.
  INSERT INTO esiti VALUES ('una visita in eccesso non rompe la pagina', errore = '',
    CASE WHEN errore = '' THEN 'scartata senza errore' ELSE errore END);
END $$;
RESET ROLE;

-- =============================================================================
-- 3. Chi ha un account non conta due volte nella stessa ora
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"93333333-3333-3333-3333-333333333333","role":"authenticated"}';
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..5 LOOP
    BEGIN
      INSERT INTO public.product_views (product_id, user_id)
      VALUES ('99999999-9999-9999-9999-999999999999', '93333333-3333-3333-3333-333333333333');
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;
END $$;
RESET ROLE;
RESET request.jwt.claims;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.product_views
   WHERE user_id = '93333333-3333-3333-3333-333333333333';
  INSERT INTO esiti VALUES ('chi ha un account conta una volta all''ora', n = 1,
    'su 5 tentativi ne sono state scritte ' || n);
END $$;

-- =============================================================================
-- 4. Nessuno può attribuire una visita a un altro
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"93333333-3333-3333-3333-333333333333","role":"authenticated"}';
DO $$
DECLARE riuscito boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.product_views (product_id, user_id)
    VALUES ('99999999-9999-9999-9999-999999999999', '91111111-1111-1111-1111-111111111111');
    riuscito := true;
  EXCEPTION WHEN others THEN riuscito := false;
  END;
  INSERT INTO esiti VALUES ('una visita non si attribuisce a un altro', NOT riuscito,
    CASE WHEN riuscito THEN 'accettata' ELSE 'respinta' END);
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE NOT ok;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
