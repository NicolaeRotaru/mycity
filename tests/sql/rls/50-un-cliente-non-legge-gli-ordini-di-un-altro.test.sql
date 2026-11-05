-- =============================================================================
-- Un cliente non legge gli ordini di un altro cliente
-- =============================================================================
-- 5/11/2026 (S04, scheda 486) — Questa prova stava in tests/sql/rls-orders.test.sql,
-- un livello sopra la cartella che run.sh esegue (tests/sql/rls/*.test.sql): non
-- girava mai. E anche girando non poteva fallire: contava le righe e lasciava il
-- giudizio a un commento («✅ PASS se count = 0»). Ora sta qui, e se il conto non
-- è zero la transazione si ferma con RAISE EXCEPTION.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('d5000000-0000-0000-0000-00000000aaaa', 'test-a-50@example.com', '{"role":"buyer"}'),
  ('d5000000-0000-0000-0000-00000000bbbb', 'test-b-50@example.com', '{"role":"buyer"}'),
  ('d5000000-0000-0000-0000-00000000cccc', 'forno-50@example.com',  '{"role":"seller"}');

-- L'ordine di A (scritto dal server, come la cassa).
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status, delivery_status,
  pickup_in_store, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'd5000000-0000-0000-0000-0000000000a1', 'd5000000-0000-0000-0000-00000000aaaa', 'd5000000-0000-0000-0000-00000000cccc',
  25, 2500, 'card', 'PAID', 'NEW', false, 'Anna A', '333 111', 'Via A 1', 'Piacenza', '29121');

-- B prova a leggerlo.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d5000000-0000-0000-0000-00000000bbbb","role":"authenticated"}';
INSERT INTO esiti
SELECT 'il cliente B non legge l ordine del cliente A', count(*) = 0, count(*) || ' righe'
  FROM public.orders WHERE user_id = 'd5000000-0000-0000-0000-00000000aaaa';
RESET ROLE;
RESET request.jwt.claims;

-- A lo legge: la regola non è chiusa per tutti (un «0 righe» che non vede niente non è una prova).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d5000000-0000-0000-0000-00000000aaaa","role":"authenticated"}';
INSERT INTO esiti
SELECT 'il cliente A legge il suo ordine', count(*) = 1, count(*) || ' righe'
  FROM public.orders WHERE user_id = 'd5000000-0000-0000-0000-00000000aaaa';
RESET ROLE;
RESET request.jwt.claims;

-- L'anonimo non legge nessun ordine.
SET LOCAL ROLE anon;
INSERT INTO esiti
SELECT 'l anonimo non legge l ordine di A', count(*) = 0, count(*) || ' righe'
  FROM public.orders WHERE user_id = 'd5000000-0000-0000-0000-00000000aaaa';
RESET ROLE;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;
