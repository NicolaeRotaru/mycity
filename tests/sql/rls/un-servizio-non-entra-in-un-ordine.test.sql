-- =============================================================================
-- Un servizio non entra in un ordine (migrazione 999g)
-- =============================================================================
-- Un annuncio può essere un prodotto o un servizio. Un servizio, per ora, si prenota
-- scrivendo al negozio: non si compra col carrello. Il server lo rifiuta già in cassa
-- (lib/ordini/valida-carrello.ts); questa è l'ultima porta: la riga d'ordine non nasce
-- nemmeno se qualcuno la scrive a mano. Un prodotto dello stesso negozio, invece, passa.
-- Controlla anche i vincoli: durata e «dove si fa» solo sui servizi, nei limiti giusti,
-- e che i tre abbonamenti di SDG siano diventati servizi.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a999a111-1111-1111-1111-111111111111', 'parrucchiere-999g@test.it', '{"role":"seller"}'),
  ('a999a333-3333-3333-3333-333333333333', 'cliente-999g@test.it', '{"role":"buyer"}');

UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'Salone 999g'
 WHERE id = 'a999a111-1111-1111-1111-111111111111';

-- Un prodotto (shampoo) e un servizio (taglio). Il servizio si scrive con SQL dinamico: prima della
-- 999g la colonna `tipo` non c'è, e la prova deve dire «rosso», non fermarsi all'analisi.
INSERT INTO public.products (id, seller_id, name, description, price, stock, status)
VALUES ('a999a999-9999-9999-9999-999999999901', 'a999a111-1111-1111-1111-111111111111',
        'Shampoo 999g', 'per i test', 9.00, 10, 'available');

DO $$
BEGIN
  EXECUTE $q$
    INSERT INTO public.products (id, seller_id, name, description, price, stock, status, tipo, durata_minuti, dove_servizio)
    VALUES ('a999a999-9999-9999-9999-999999999902', 'a999a111-1111-1111-1111-111111111111',
            'Taglio 999g', 'per i test', 20.00, NULL, 'available', 'servizio', 45, 'in_negozio')
  $q$;
  INSERT INTO esiti VALUES ('un servizio si salva con durata e «dove si fa»', true, 'salvato');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO esiti VALUES ('un servizio si salva con durata e «dove si fa»', false, SQLERRM);
END $$;

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, payment_method, payment_status,
  delivery_status, delivered_at, payout_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a999aaaa-0000-0000-0000-0000000000c1', 'a999a333-3333-3333-3333-333333333333',
  'a999a111-1111-1111-1111-111111111111', 9.00, 'card', 'PAID', 'DELIVERED', now(), 'HELD',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

DO $$
DECLARE n int; esito text;
BEGIN
  -- Il servizio non diventa una riga d'ordine.
  IF EXISTS (SELECT 1 FROM public.products WHERE id = 'a999a999-9999-9999-9999-999999999902') THEN
    BEGIN
      INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
      VALUES ('a999aaaa-0000-0000-0000-0000000000c1', 'a999a999-9999-9999-9999-999999999902', 1, 20.00);
      esito := 'passata';
    EXCEPTION WHEN check_violation THEN esito := 'rifiutata';
    END;
  ELSE
    esito := 'il servizio non esiste (manca la 999g)';
  END IF;
  INSERT INTO esiti VALUES ('la riga d''ordine con un servizio è rifiutata', esito = 'rifiutata', esito);

  -- Il prodotto dello stesso negozio passa.
  BEGIN
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES ('a999aaaa-0000-0000-0000-0000000000c1', 'a999a999-9999-9999-9999-999999999901', 1, 9.00);
    esito := 'passata';
  EXCEPTION WHEN OTHERS THEN esito := 'rifiutata: ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('la riga d''ordine di un prodotto passa', esito = 'passata', esito);

  -- Una riga esistente non si trasforma in un servizio.
  IF EXISTS (SELECT 1 FROM public.products WHERE id = 'a999a999-9999-9999-9999-999999999902') THEN
    BEGIN
      UPDATE public.order_items SET product_id = 'a999a999-9999-9999-9999-999999999902'
       WHERE order_id = 'a999aaaa-0000-0000-0000-0000000000c1';
      esito := 'passata';
    EXCEPTION WHEN check_violation THEN esito := 'rifiutata';
    END;
  ELSE
    esito := 'il servizio non esiste (manca la 999g)';
  END IF;
  INSERT INTO esiti VALUES ('una riga esistente non si trasforma in un servizio', esito = 'rifiutata', esito);

  -- Un prodotto già venduto che diventa servizio: la riga vecchia resta, ma non se ne aggiungono altre.
  BEGIN
    EXECUTE 'UPDATE public.products SET tipo = ''servizio'' WHERE id = ''a999a999-9999-9999-9999-999999999901''';
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES ('a999aaaa-0000-0000-0000-0000000000c1', 'a999a999-9999-9999-9999-999999999901', 1, 9.00);
    esito := 'passata';
  EXCEPTION WHEN check_violation THEN esito := 'rifiutata';
            WHEN OTHERS THEN esito := 'errore: ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('un prodotto diventato servizio non entra in un ordine nuovo', esito = 'rifiutata', esito);

  -- Durata e «dove si fa» non stanno su un prodotto.
  BEGIN
    EXECUTE $q$
      INSERT INTO public.products (seller_id, name, description, price, stock, status, tipo, durata_minuti)
      VALUES ('a999a111-1111-1111-1111-111111111111', 'Pettine 999g', 'per i test', 3, 5, 'available', 'prodotto', 30)
    $q$;
    esito := 'passata';
  EXCEPTION WHEN check_violation THEN esito := 'rifiutata';
            WHEN OTHERS THEN esito := 'errore: ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('un prodotto non può avere una durata', esito = 'rifiutata', esito);

  -- La durata sta fra 5 e 1440 minuti.
  BEGIN
    EXECUTE $q$
      INSERT INTO public.products (seller_id, name, description, price, stock, status, tipo, durata_minuti)
      VALUES ('a999a111-1111-1111-1111-111111111111', 'Piega 999g', 'per i test', 15, NULL, 'available', 'servizio', 2000)
    $q$;
    esito := 'passata';
  EXCEPTION WHEN check_violation THEN esito := 'rifiutata';
            WHEN OTHERS THEN esito := 'errore: ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('una durata oltre un giorno è rifiutata', esito = 'rifiutata', esito);

  -- «Dove si fa» è uno dei tre valori.
  BEGIN
    EXECUTE $q$
      INSERT INTO public.products (seller_id, name, description, price, stock, status, tipo, dove_servizio)
      VALUES ('a999a111-1111-1111-1111-111111111111', 'Colore 999g', 'per i test', 30, NULL, 'available', 'servizio', 'sulla_luna')
    $q$;
    esito := 'passata';
  EXCEPTION WHEN check_violation THEN esito := 'rifiutata';
            WHEN OTHERS THEN esito := 'errore: ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('un «dove si fa» sconosciuto è rifiutato', esito = 'rifiutata', esito);

  -- Gli abbonamenti di SDG sono servizi.
  BEGIN
    EXECUTE $q$
      SELECT count(*) FROM public.products
       WHERE seller_id = '11111111-1111-1111-1111-5d9000000001' AND tipo = 'servizio'
    $q$ INTO n;
    esito := n || ' servizi';
  EXCEPTION WHEN OTHERS THEN n := 0; esito := 'errore: ' || SQLERRM;
  END;
  INSERT INTO esiti VALUES ('i tre abbonamenti di SDG sono servizi', n = 3, esito);
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
