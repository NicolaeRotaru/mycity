-- =============================================================================
-- R08-012 (onda 2) — Il buono regalo in attesa tiene i dati del destinatario da noi, e solo il server li legge
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- La cassa del buono (app/api/gift-cards/checkout/route.ts) scrive nome, email e messaggio del destinatario
-- in gift_card_in_attesa invece di mandarli a Stripe (migrazione 999j).
-- ① chi compra, coi suoi permessi, non legge la tabella (neanche le sue righe: le legge solo il server)
-- ② e non ci scrive
-- ③ il server scrive e rilegge il tentativo
-- ④ stessa chiave dello stesso compratore: una riga sola (23505)
-- ⑤ cancellato l'account di chi compra, i suoi tentativi se ne vanno con lui
-- Tutto con ROLLBACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0812000-0000-0000-0000-00000000000b', 'compra-buono-o2a@test.it', '{"role":"buyer"}');

SET LOCAL ROLE service_role;
DO $$
DECLARE n int;
BEGIN
  INSERT INTO public.gift_card_in_attesa (buyer_id, chiave, amount_cents, recipient_name, recipient_email, message)
  VALUES ('e0812000-0000-0000-0000-00000000000b', 'tentativo-1', 2500, 'Chiara', 'chiara@example.com', 'Auguri');
  SELECT count(*) INTO n FROM public.gift_card_in_attesa WHERE buyer_id = 'e0812000-0000-0000-0000-00000000000b';
  INSERT INTO esiti VALUES ('③ il server scrive e rilegge il tentativo', n = 1, n || ' righe');
  BEGIN
    INSERT INTO public.gift_card_in_attesa (buyer_id, chiave, amount_cents)
    VALUES ('e0812000-0000-0000-0000-00000000000b', 'tentativo-1', 2500);
    INSERT INTO esiti VALUES ('④ stessa chiave, una riga sola', false, 'doppione accettato');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO esiti VALUES ('④ stessa chiave, una riga sola', true, SQLERRM);
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e0812000-0000-0000-0000-00000000000b","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.gift_card_in_attesa;
    INSERT INTO esiti VALUES ('① chi compra non legge la tabella', false, n || ' righe lette');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('① chi compra non legge la tabella', true, SQLERRM);
  END;
  BEGIN
    INSERT INTO public.gift_card_in_attesa (buyer_id, chiave, amount_cents)
    VALUES ('e0812000-0000-0000-0000-00000000000b', 'dal-browser', 2500);
    INSERT INTO esiti VALUES ('② chi compra non ci scrive', false, 'riga scritta dal browser');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('② chi compra non ci scrive', true, SQLERRM);
  END;
END $$;
RESET ROLE;

DELETE FROM auth.users WHERE id = 'e0812000-0000-0000-0000-00000000000b';
INSERT INTO esiti
SELECT '⑤ cancellato chi compra, i tentativi se ne vanno', count(*) = 0, count(*) || ' righe rimaste'
  FROM public.gift_card_in_attesa WHERE buyer_id = 'e0812000-0000-0000-0000-00000000000b';

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 OR (SELECT count(*) FROM esiti) <> 5 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
