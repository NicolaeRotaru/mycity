-- =============================================================================
-- Modalità demo — un negozio nuovo che non ha pagato non si vede sul marketplace (migrazione 709)
-- =============================================================================
-- Nicola, 24/11/2026: «Tutte le attività che si iscrivono però non hanno effettuato il loro
-- pagamento entrano sulla piattaforma in modalità demo e la loro vetrina non è visibile».
-- Un negozio approvato DOPO la 709 senza abbonamento ai servizi: i suoi prodotti, la sua riga nella
-- vista pubblica, la classifica del negozio del mese e la ricerca non lo mostrano a un visitatore né a un cliente.
-- Lo vede solo lui. Con l'abbonamento «active» o «past_due» si vede; con «canceled» torna in demo.
-- Chi era già online (visibile_senza_abbonamento) resta visibile. Il negozio non può mettersi da
-- solo visibile_senza_abbonamento. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;
CREATE TEMP TABLE visto (chi text, cosa text, quanti int) ON COMMIT DROP;
GRANT ALL ON visto TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('d7091111-1111-1111-1111-111111111111', 'negozio-demo-709@test.it', '{"role":"seller"}'),
  ('d7092222-2222-2222-2222-222222222222', 'negozio-storico-709@test.it', '{"role":"seller"}'),
  ('d7093333-3333-3333-3333-333333333333', 'cliente-709@test.it', '{"role":"buyer"}');

-- Il negozio nuovo: approvato dopo la 709, nessun abbonamento.
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega Demo 709'
 WHERE id = 'd7091111-1111-1111-1111-111111111111';
-- Il negozio già online prima della modalità demo.
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega Storica 709',
       visibile_senza_abbonamento = true
 WHERE id = 'd7092222-2222-2222-2222-222222222222';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status) VALUES
  ('d709aaaa-0000-0000-0000-000000000001', 'd7091111-1111-1111-1111-111111111111', 'Zzdemo torta', 'prova', 9.00, 5, 'available'),
  ('d709aaaa-0000-0000-0000-000000000002', 'd7092222-2222-2222-2222-222222222222', 'Zzdemo pane', 'prova', 3.00, 5, 'available');

INSERT INTO public.seller_stories (seller_id, image_url, caption, expires_at)
VALUES ('d7091111-1111-1111-1111-111111111111', 'https://example.org/s.jpg', 'storia demo', now() + interval '1 day');
INSERT INTO public.seller_promotions (seller_id, title, discount_percent, scope, starts_at, ends_at, status)
VALUES ('d7091111-1111-1111-1111-111111111111', 'promo demo', 20, 'store', now() - interval '1 hour', now() + interval '1 day', 'active');

RESET mycity.allow_profile_write;

CREATE OR REPLACE FUNCTION pg_temp.guarda(chi text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO visto SELECT chi, 'prodotto demo', count(*) FROM public.products WHERE id = 'd709aaaa-0000-0000-0000-000000000001';
  INSERT INTO visto SELECT chi, 'prodotto storico', count(*) FROM public.products WHERE id = 'd709aaaa-0000-0000-0000-000000000002';
  INSERT INTO visto SELECT chi, 'vetrina demo', count(*) FROM public.seller_public_profiles WHERE id = 'd7091111-1111-1111-1111-111111111111';
  INSERT INTO visto SELECT chi, 'vetrina storica', count(*) FROM public.seller_public_profiles WHERE id = 'd7092222-2222-2222-2222-222222222222';
  INSERT INTO visto SELECT chi, 'classifica demo', count(*) FROM public.shop_of_month_leaderboard WHERE seller_id = 'd7091111-1111-1111-1111-111111111111';
  INSERT INTO visto SELECT chi, 'storie demo', count(*) FROM public.seller_stories WHERE seller_id = 'd7091111-1111-1111-1111-111111111111';
  INSERT INTO visto SELECT chi, 'promo demo', count(*) FROM public.seller_promotions WHERE seller_id = 'd7091111-1111-1111-1111-111111111111';
  INSERT INTO visto SELECT chi, 'sconto demo', count(*) FROM public.product_active_discounts(ARRAY['d709aaaa-0000-0000-0000-000000000001'::uuid]) d WHERE d.discount_percent > 0;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.guarda(text) TO anon, authenticated;

-- ① Senza abbonamento -----------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_temp.guarda('visitatore');
RESET ROLE;

SET LOCAL request.jwt.claims = '{"sub":"d7093333-3333-3333-3333-333333333333","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.guarda('cliente');
RESET ROLE;
RESET request.jwt.claims;

SET LOCAL request.jwt.claims = '{"sub":"d7091111-1111-1111-1111-111111111111","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.guarda('il negozio');
-- Il negozio prova a rendersi visibile da solo.
DO $$
DECLARE esito text;
BEGIN
  BEGIN
    UPDATE public.profiles SET visibile_senza_abbonamento = true WHERE id = 'd7091111-1111-1111-1111-111111111111';
    esito := 'scritto';
  EXCEPTION WHEN insufficient_privilege THEN esito := 'negato';
  END;
  INSERT INTO esiti VALUES ('il negozio non si mette da solo visibile_senza_abbonamento', esito = 'negato', esito);
END $$;
RESET ROLE;
RESET request.jwt.claims;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM visto LOOP
    INSERT INTO esiti VALUES (
      'senza abbonamento, ' || r.chi || ': ' || r.cosa,
      CASE
        WHEN r.cosa LIKE '%storic%' THEN r.quanti = 1                         -- chi era già online resta
        WHEN r.chi = 'il negozio' AND r.cosa IN ('prodotto demo', 'vetrina demo', 'storie demo', 'promo demo') THEN r.quanti = 1  -- si vede da sé
        ELSE r.quanti = 0                                                      -- il resto del mondo no
      END,
      r.quanti || ' righe');
  END LOOP;
  DELETE FROM visto;
END $$;

-- La ricerca non lo trova (funzione a permessi di chi chiama).
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.search_products_smart('Zzdemo', 20) s WHERE s.id = 'd709aaaa-0000-0000-0000-000000000001';
  INSERT INTO esiti VALUES ('la ricerca non trova il prodotto del negozio in demo', n = 0, n || ' righe');
  SELECT count(*) INTO n FROM public.search_products_smart('Zzdemo', 20) s WHERE s.id = 'd709aaaa-0000-0000-0000-000000000002';
  INSERT INTO esiti VALUES ('la ricerca trova il prodotto del negozio già online', n = 1, n || ' righe');
END $$;
RESET ROLE;

-- ② Con l'abbonamento «active», poi «past_due», poi «canceled» ----------------------------------
INSERT INTO public.abbonamenti_servizi (seller_id, fascia, canone_centesimi, stripe_subscription_id, stato)
VALUES ('d7091111-1111-1111-1111-111111111111', 'base', 30000, 'sub_demo_709', 'active');

SET LOCAL ROLE anon;
SELECT pg_temp.guarda('visitatore, active');
RESET ROLE;
UPDATE public.abbonamenti_servizi SET stato = 'past_due' WHERE stripe_subscription_id = 'sub_demo_709';
SET LOCAL ROLE anon;
SELECT pg_temp.guarda('visitatore, past_due');
RESET ROLE;
UPDATE public.abbonamenti_servizi SET stato = 'canceled' WHERE stripe_subscription_id = 'sub_demo_709';
SET LOCAL ROLE anon;
SELECT pg_temp.guarda('visitatore, canceled');
RESET ROLE;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM visto WHERE cosa IN ('prodotto demo', 'vetrina demo', 'classifica demo', 'storie demo', 'promo demo', 'sconto demo') LOOP
    INSERT INTO esiti VALUES (
      r.chi || ': ' || r.cosa,
      CASE WHEN r.chi LIKE '%canceled' THEN r.quanti = 0 ELSE r.quanti = 1 END,
      r.quanti || ' righe');
  END LOOP;
END $$;

-- ③ Un negozio non approvato non si vede nemmeno con l'abbonamento -----------------------------
SET LOCAL mycity.allow_profile_write = '1';
UPDATE public.abbonamenti_servizi SET stato = 'active' WHERE stripe_subscription_id = 'sub_demo_709';
UPDATE public.profiles SET is_approved = false, approval_status = 'suspended' WHERE id = 'd7091111-1111-1111-1111-111111111111';
RESET mycity.allow_profile_write;
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.products WHERE id = 'd709aaaa-0000-0000-0000-000000000001';
  INSERT INTO esiti VALUES ('sospeso con abbonamento attivo: il prodotto non si vede', n = 0, n || ' righe');
END $$;
RESET ROLE;

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
