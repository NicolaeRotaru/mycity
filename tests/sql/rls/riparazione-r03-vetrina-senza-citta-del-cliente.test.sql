-- =============================================================================
-- R03-009 — Il riquadro dal vivo non scrive la «città» del cliente (migrazione 271)
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- Un ordine con città «Quarto, via Verdi 10 citofono Rossi» presso «Farmacia del
-- Corso». Il visitatore anonimo legge la vista: non deve trovarci niente di
-- scritto dal cliente. Senza la 271 il controllo è rosso. ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'farmacia@test.it', '{"role":"seller"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it',  '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Farmacia del Corso',
       store_address = 'Corso Vittorio Emanuele 1', store_lat = 45.05, store_lng = 9.69
 WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, payment_method, payment_status,
  delivery_status, payout_status, seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, created_at
) VALUES (
  'a0000000-0000-0000-0000-0000000000f1', '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111', 20.00, 2000, 'cod', 'PAID', 'NEW', 'AWAITING_REMITTANCE', 1800, 300,
  'Anna Rossi', '3331234567', 'Via Verdi 10', 'Quarto, via Verdi 10 citofono Rossi', '29122',
  date_trunc('hour', now() - interval '2 hours') + interval '30 minutes'
);

SET LOCAL mycity.allow_profile_write = '0';
SET LOCAL mycity.allow_order_write   = '0';
SET LOCAL ROLE anon;

INSERT INTO esiti
SELECT 'il visitatore anonimo vede la farmacia nel riquadro',
       count(*) >= 1, 'righe della farmacia: ' || count(*)
  FROM public.live_activity_public WHERE store_name = 'Farmacia del Corso';

INSERT INTO esiti
SELECT 'nella vista non esce niente di scritto dal cliente nel campo città',
       bool_and(coalesce(delivery_city, '') NOT ILIKE '%verdi%' AND coalesce(delivery_city, '') NOT ILIKE '%quarto%'),
       'città lette: ' || coalesce(string_agg(DISTINCT coalesce(delivery_city, '∅'), ' | '), '—')
  FROM public.live_activity_public;

INSERT INTO esiti
SELECT 'la città del riquadro è solo Piacenza',
       bool_and(delivery_city IS NULL OR delivery_city = 'Piacenza'), ''
  FROM public.live_activity_public;

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
