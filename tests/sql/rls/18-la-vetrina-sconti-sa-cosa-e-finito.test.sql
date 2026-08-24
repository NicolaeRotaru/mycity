-- =============================================================================
-- La vetrina degli sconti sa cosa è finito e cosa ha varianti
-- =============================================================================
-- La funzione `active_promo_products` alimenta la sezione «Sconti attivi» in home
-- e la pagina /promozioni: il traffico più caldo, quello attirato dallo sconto.
-- Fino al 24 agosto ritornava sette colonne e fra quelle non c'erano né la
-- giacenza né «questo prodotto ha varianti».
--
-- Senza quei due campi la scheda non poteva sapere niente: il badge «Esaurito»
-- non compariva mai, il «+» era sempre premibile, e su un prodotto con varianti
-- aggiungeva al carrello una riga senza variante. Il muro arrivava al checkout,
-- dopo che la persona aveva già scelto.
--
-- Questa prova diventa rossa se qualcuno toglie di nuovo quei due campi, o se
-- la funzione smette di dire la verità su un prodotto finito.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'bottega-sconti@test.it', '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', role = 'seller',
       store_name = 'Bottega degli sconti'
 WHERE id = 'b1111111-1111-1111-1111-111111111111';

-- Tre prodotti in saldo nello stesso negozio: uno normale, uno finito, uno con varianti.
INSERT INTO public.products (id, seller_id, name, description, price, stock, status, has_variants, images)
VALUES
  ('b2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111',
   'Coppa intera', 'ce n''è', 20, 5, 'available', false, '[]'::jsonb),
  ('b3333333-3333-3333-3333-333333333333', 'b1111111-1111-1111-1111-111111111111',
   'Coppa finita', 'non ce n''è più', 20, 0, 'available', false, '[]'::jsonb),
  ('b4444444-4444-4444-4444-444444444444', 'b1111111-1111-1111-1111-111111111111',
   'Grembiule', 'in tre taglie', 20, 9, 'available', true, '[]'::jsonb);

-- Uno sconto attivo su tutto il negozio.
INSERT INTO public.seller_promotions (id, seller_id, title, scope, discount_percent, status, starts_at, ends_at)
VALUES ('b5555555-5555-5555-5555-555555555555', 'b1111111-1111-1111-1111-111111111111',
        'Saldi di prova', 'store', 20, 'active', now() - interval '1 day', now() + interval '7 days');

DO $$
DECLARE
  quanti int;
  giacenza int;
  varianti boolean;
BEGIN
  -- ① I due campi esistono e arrivano fino a chi disegna la scheda.
  SELECT count(*) INTO quanti
    FROM public.active_promo_products(50, 'b1111111-1111-1111-1111-111111111111'::uuid);
  INSERT INTO esiti VALUES (
    'la vetrina sconti restituisce i tre prodotti in saldo',
    quanti = 3,
    'ne torna ' || quanti || ', ne servono 3');

  -- ② Il prodotto finito dice di essere finito. Se questa riga sparisce, la
  --    scheda torna a mostrare il «+» acceso su una cosa che non si può comprare.
  SELECT stock INTO giacenza
    FROM public.active_promo_products(50, 'b1111111-1111-1111-1111-111111111111'::uuid)
   WHERE product_id = 'b3333333-3333-3333-3333-333333333333';
  INSERT INTO esiti VALUES (
    'del prodotto finito si sa che è finito',
    giacenza = 0,
    'la giacenza torna ' || COALESCE(giacenza::text, 'NULL') || ', deve tornare 0');

  -- ③ E quello con varianti dice di averne. Senza, il «+» aggiunge una riga
  --    senza taglia e il checkout si blocca.
  SELECT has_variants INTO varianti
    FROM public.active_promo_products(50, 'b1111111-1111-1111-1111-111111111111'::uuid)
   WHERE product_id = 'b4444444-4444-4444-4444-444444444444';
  INSERT INTO esiti VALUES (
    'del prodotto con varianti si sa che ne ha',
    varianti IS TRUE,
    'has_variants torna ' || COALESCE(varianti::text, 'NULL') || ', deve tornare true');

  -- ④ Il prodotto normale non viene marcato per sbaglio.
  SELECT has_variants INTO varianti
    FROM public.active_promo_products(50, 'b1111111-1111-1111-1111-111111111111'::uuid)
   WHERE product_id = 'b2222222-2222-2222-2222-222222222222';
  INSERT INTO esiti VALUES (
    'il prodotto senza varianti non risulta averne',
    varianti IS FALSE,
    'has_variants torna ' || COALESCE(varianti::text, 'NULL') || ', deve tornare false');
END $$;

-- =============================================================================
-- Verdetto
-- =============================================================================
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
