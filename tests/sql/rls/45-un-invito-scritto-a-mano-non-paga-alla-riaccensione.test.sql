-- =============================================================================
-- Un invito scritto a mano non paga, nemmeno a inviti riaccesi (186)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: la policy INSERT su `referrals` (015, ristretta dalla 092) lascia
-- a ogni utente collegato scrivere «mi ha invitato A». Oggi la 168 spegne il
-- premio con punti_fedelta_accesi() = false; il giorno che si riaccende, Bruno
-- scrive referrals(referrer = Anna, referred = Bruno), il suo ordine arriva a
-- DELIVERED e Anna riceve 5 euro di credito vero (referral_reward nel wallet).
--
-- La prova simula la riaccensione DENTRO la transazione (ROLLBACK in fondo):
--   ① Bruno, collegato, scrive l'invito a mano        → rifiutato
--   ② l'ordine di Bruno arriva a DELIVERED            → nessun referral_reward ad Anna
--   ③ un invito scritto dal server (service_role)     → il premio paga ancora
--      (la porta chiusa e' quella del cliente, non il premio in se')
-- Senza la 186 i passi ① e ② sono rossi.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

-- La riaccensione degli inviti, solo dentro questa transazione.
CREATE OR REPLACE FUNCTION public.punti_fedelta_accesi()
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT true $$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it', '{"role":"seller"}'),
  ('22222222-2222-2222-2222-222222222222', 'anna@test.it',    '{"role":"buyer"}'),
  ('33333333-3333-3333-3333-333333333333', 'bruno@test.it',   '{"role":"buyer"}'),
  ('44444444-4444-4444-4444-444444444444', 'carla@test.it',   '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Bottega di prova',
       store_address = 'Via Roma 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';

-- ① Bruno scrive a mano «mi ha invitato Anna».
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.referrals (referrer_id, referred_id)
    VALUES ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
    INSERT INTO esiti VALUES ('1 invito a mano: rifiutato', false, 'la riga e'' entrata');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO esiti VALUES ('1 invito a mano: rifiutato', true, SQLERRM);
  END;
END $$;
RESET ROLE;

-- ② L'ordine di Bruno (contanti, 12 euro) arriva a DELIVERED.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000004a5',
  '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
  12.00, 1200, 'cod', 'PENDING', 'NEW',
  'Bruno Bianchi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);
UPDATE public.orders SET delivery_status = 'DELIVERED'
 WHERE id = 'a0000000-0000-0000-0000-0000000004a5';

INSERT INTO esiti
SELECT '2 consegna di Bruno: niente premio ad Anna', count(*) = 0,
       count(*) || ' movimenti referral_reward'
  FROM public.wallet_ledger
 WHERE user_id = '22222222-2222-2222-2222-222222222222' AND reason = 'referral_reward';

-- ③ Un invito scritto dal server per Carla: il premio paga ancora.
SET LOCAL ROLE service_role;
INSERT INTO public.referrals (referrer_id, referred_id)
VALUES ('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444');
RESET ROLE;

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000004a6',
  '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
  35.00, 3500, 'card', 'PAID', 'NEW',
  'Carla Verdi', '3337654321', 'Via Neri 2', 'Piacenza', '29121'
);
UPDATE public.orders SET delivery_status = 'DELIVERED'
 WHERE id = 'a0000000-0000-0000-0000-0000000004a6';
-- Il doppio tocco: la stessa consegna riscritta non paga due volte.
UPDATE public.orders SET delivery_status = 'OUT_FOR_DELIVERY'
 WHERE id = 'a0000000-0000-0000-0000-0000000004a6';
UPDATE public.orders SET delivery_status = 'DELIVERED'
 WHERE id = 'a0000000-0000-0000-0000-0000000004a6';

INSERT INTO esiti
SELECT '3 invito del server: un premio solo', count(*) = 1 AND coalesce(sum(delta_cents), 0) = 500,
       count(*) || ' movimenti, ' || coalesce(sum(delta_cents), 0) || ' centesimi'
  FROM public.wallet_ledger
 WHERE user_id = '22222222-2222-2222-2222-222222222222' AND reason = 'referral_reward'
   AND ref = 'a0000000-0000-0000-0000-0000000004a6';

SELECT nome, CASE WHEN ok THEN 'ok' ELSE 'ROTTO' END AS esito, dettaglio FROM esiti ORDER BY nome;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM esiti WHERE ok IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '% controlli falliti sull''invito scritto a mano', n;
  END IF;
END $$;

ROLLBACK;
