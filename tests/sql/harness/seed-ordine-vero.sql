-- =============================================================================
-- Un ordine vero, per provare le migrazioni su un database che non è vuoto
-- =============================================================================
-- Lo usa `migrazione-su-database-pieno.sh`. NON è una prova: è la materia prima
-- della prova. Deve valere prima dell'ultima migrazione, quindi qui non si
-- nomina nessuna colonna che nasca con quella.
--
-- L'ordine ha un credito MyCity scomputato in cassa (`wallet_applied_cents`):
-- è il caso in cui il lordo di vendita e la cassa attesa NON coincidono, cioè
-- quello che una migrazione di riscrittura deve saper trattare.
-- =============================================================================

SET mycity.allow_profile_write = '1';
SET mycity.allow_order_write   = '1';

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'negozio@test.it', '{"role":"seller"}'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane Quotidiano',
       stripe_charges_enabled = true, stripe_payouts_enabled = true
 WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, wallet_applied_cents,
  payment_method, payment_status, delivery_status, payout_status,
  seller_payout_cents, rider_fee_cents,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000000f9',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  30.00, 2000, 'card', 'PAID', 'NEW', 'HELD', 4500, 300,
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

RESET mycity.allow_order_write;
RESET mycity.allow_profile_write;
