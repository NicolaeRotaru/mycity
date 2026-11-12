-- =============================================================================
-- R11-004 — Il bonifico del lunedì al negozio si può segnare (migrazione 350)
-- =============================================================================
-- Solo un amministratore porta a PAID_MANUALLY i contanti HELD consegnati di UN
-- negozio. Il negozio stesso non può; una carta, un altro negozio o un contante
-- non ancora rimesso non si toccano. Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1100000-0000-0000-0000-000000000001', 'forno-r11@test.it',   '{"role":"seller"}'),
  ('e1100000-0000-0000-0000-000000000002', 'altro-r11@test.it',   '{"role":"seller"}'),
  ('e1100000-0000-0000-0000-000000000003', 'cliente-r11@test.it', '{"role":"buyer"}'),
  ('e1100000-0000-0000-0000-000000000004', 'capo-r11@test.it',    '{"role":"admin"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved'
 WHERE id IN ('e1100000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000002',
              'e1100000-0000-0000-0000-000000000003');
UPDATE public.profiles SET role = 'admin' WHERE id = 'e1100000-0000-0000-0000-000000000004';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e1100000-0000-0000-0000-0000000000a1', 'e1100000-0000-0000-0000-000000000003', 'e1100000-0000-0000-0000-000000000001',
   20, 2000, 'cod', 'PAID', 'DELIVERED', now(), false, 'HELD', 1800, 'Maria', '333', 'Via A 1', 'Piacenza', '29121'),
  ('e1100000-0000-0000-0000-0000000000a2', 'e1100000-0000-0000-0000-000000000003', 'e1100000-0000-0000-0000-000000000001',
   20, 2000, 'card', 'PAID', 'DELIVERED', now(), false, 'HELD', 1800, 'Maria', '333', 'Via A 1', 'Piacenza', '29121'),
  ('e1100000-0000-0000-0000-0000000000a3', 'e1100000-0000-0000-0000-000000000003', 'e1100000-0000-0000-0000-000000000001',
   20, 2000, 'cod', 'PENDING', 'DELIVERED', now(), false, 'AWAITING_REMITTANCE', 1800, 'Maria', '333', 'Via A 1', 'Piacenza', '29121'),
  ('e1100000-0000-0000-0000-0000000000b1', 'e1100000-0000-0000-0000-000000000003', 'e1100000-0000-0000-0000-000000000002',
   20, 2000, 'cod', 'PAID', 'DELIVERED', now(), false, 'HELD', 1800, 'Maria', '333', 'Via A 1', 'Piacenza', '29121');

-- Contante rimesso ma con un reclamo aperto: il giro automatico lo trattiene, il bonifico a mano pure.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivered_at, pickup_in_store, payout_status, seller_payout_cents, internal_dispute_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES
  ('e1100000-0000-0000-0000-0000000000a4', 'e1100000-0000-0000-0000-000000000003', 'e1100000-0000-0000-0000-000000000001',
   20, 2000, 'cod', 'PAID', 'DELIVERED', now(), false, 'HELD', 1800, 'OPEN', 'Maria', '333', 'Via A 1', 'Piacenza', '29121');

SET LOCAL mycity.allow_order_write = '';

-- ① Il negozio prova a segnarsi pagato da solo.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1100000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  PERFORM public.segna_bonifico_manuale('e1100000-0000-0000-0000-000000000001',
    ARRAY['e1100000-0000-0000-0000-0000000000a1']::uuid[], 'TRN-123');
  INSERT INTO esiti VALUES ('il negozio non si segna pagato da solo', false, 'la funzione ha risposto');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO esiti VALUES ('il negozio non si segna pagato da solo', true, 'forbidden');
END $$;
RESET ROLE;
RESET request.jwt.claims;

-- ② L'amministratore segna il bonifico, passando anche id che non deve toccare.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"e1100000-0000-0000-0000-000000000004","role":"authenticated"}';
INSERT INTO esiti
SELECT 'l amministratore segna solo il contante HELD di quel negozio', n = 1, n || ' ordini segnati'
  FROM (SELECT public.segna_bonifico_manuale('e1100000-0000-0000-0000-000000000001',
          ARRAY['e1100000-0000-0000-0000-0000000000a1', 'e1100000-0000-0000-0000-0000000000a2',
                'e1100000-0000-0000-0000-0000000000a3', 'e1100000-0000-0000-0000-0000000000b1',
                'e1100000-0000-0000-0000-0000000000a4']::uuid[],
          'TRN-123') AS n) t;
RESET ROLE;
RESET request.jwt.claims;

INSERT INTO esiti
SELECT 'il contante rimesso diventa PAID_MANUALLY con data e riferimento',
       payout_status = 'PAID_MANUALLY' AND payout_at IS NOT NULL AND payout_manual_ref = 'TRN-123',
       format('%s · %s · %s', payout_status, payout_at, payout_manual_ref)
  FROM public.orders WHERE id = 'e1100000-0000-0000-0000-0000000000a1';

INSERT INTO esiti
SELECT 'carta, contante non rimesso, altro negozio e contante con reclamo aperto restano come erano',
       bool_and(payout_status <> 'PAID_MANUALLY'), string_agg(id::text || '=' || payout_status, ', ')
  FROM public.orders WHERE id IN ('e1100000-0000-0000-0000-0000000000a2', 'e1100000-0000-0000-0000-0000000000a3',
                                  'e1100000-0000-0000-0000-0000000000b1', 'e1100000-0000-0000-0000-0000000000a4');

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
