-- =============================================================================
-- SDG Agenzia — un abbonamento non entra in un ordine (migrazione 707)
-- =============================================================================
-- I tre abbonamenti ai servizi sono prodotti nella vetrina di SDG, ma si attivano dal
-- preventivo, mai come ordine con la consegna. Il server li rifiuta già in cassa
-- (lib/ordini/valida-carrello.ts); questa è l'ultima porta: la riga d'ordine non nasce
-- nemmeno se qualcuno la scrive a mano. Un prodotto di un negozio vero, invece, passa.
-- Controlla anche che SDG esista, approvata, coi suoi tre abbonamenti ai prezzi del listino.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a7071111-1111-1111-1111-111111111111', 'negozio-707@test.it', '{"role":"seller"}'),
  ('a7073333-3333-3333-3333-333333333333', 'cliente-707@test.it', '{"role":"buyer"}');

UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Bottega 707'
 WHERE id = 'a7071111-1111-1111-1111-111111111111';

INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('a7079999-9999-9999-9999-999999999999', 'a7071111-1111-1111-1111-111111111111',
        'Pane 707', 'per i test', 3.50, 100, 'available');

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_method, payment_status,
  delivery_status, delivered_at, payout_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a707aaaa-0000-0000-0000-0000000000c1', 'a7073333-3333-3333-3333-333333333333',
  'a7071111-1111-1111-1111-111111111111', 3.50, 'card', 'PAID', 'DELIVERED', now(), 'HELD',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

DO $$
DECLARE n int; esito text;
BEGIN
  SELECT count(*) INTO n FROM public.profiles
   WHERE id = '11111111-1111-1111-1111-5d9000000001' AND role = 'seller' AND is_approved
     AND approval_status = 'approved' AND store_name = 'SDG Agenzia' AND business_type = 'altro';
  INSERT INTO esiti VALUES ('SDG Agenzia esiste, approvata, tipo altro', n = 1, n || ' righe');

  SELECT count(*) INTO n FROM public.products
   WHERE seller_id = '11111111-1111-1111-1111-5d9000000001' AND status = 'available'
     AND ((name LIKE 'Abbonamento Base%' AND price = 300) OR (name LIKE 'Abbonamento Business%' AND price = 600)
       OR (name LIKE 'Abbonamento Premium%' AND price = 900));
  INSERT INTO esiti VALUES ('i tre abbonamenti sono in vetrina al prezzo del listino', n = 3, n || ' prodotti');

  BEGIN
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES ('a707aaaa-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-5d9000000101', 1, 300);
    esito := 'passata';
  EXCEPTION WHEN check_violation THEN esito := 'rifiutata';
  END;
  INSERT INTO esiti VALUES ('la riga d''ordine con un abbonamento di SDG è rifiutata', esito = 'rifiutata', esito);

  BEGIN
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES ('a707aaaa-0000-0000-0000-0000000000c1', 'a7079999-9999-9999-9999-999999999999', 1, 3.50);
    esito := 'passata';
  EXCEPTION WHEN OTHERS THEN esito := 'rifiutata: ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('la riga d''ordine di un negozio vero passa', esito = 'passata', esito);

  BEGIN
    UPDATE public.order_items SET product_id = '11111111-1111-1111-1111-5d9000000102'
     WHERE order_id = 'a707aaaa-0000-0000-0000-0000000000c1';
    esito := 'passata';
  EXCEPTION WHEN check_violation THEN esito := 'rifiutata';
  END;
  INSERT INTO esiti VALUES ('una riga esistente non si trasforma in un abbonamento', esito = 'rifiutata', esito);
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
