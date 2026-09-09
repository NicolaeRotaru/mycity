-- =============================================================================
-- Un ordine GIÀ ANNULLATO, più un ordine vivo con la sua merce
-- =============================================================================
-- Lo usa `la-160-regge-un-ordine-annullato.sh`. NON è una prova: è la materia
-- prima della prova.
--
-- PERCHÉ SERVE UN ORDINE ANNULLATO E NON UN ORDINE QUALSIASI.
-- `seed-ordine-vero.sql` mette in tabella un ordine `NEW`. Va benissimo per le
-- migrazioni che riscrivono tutti gli ordini, ma non per quelle che riscrivono
-- solo gli ANNULLATI: lì il `WHERE delivery_status = 'CANCELED'` non trova
-- niente, tocca zero righe, e `enforce_order_update_rules` — che è un grilletto
-- per riga — non scatta mai. Prova verde su una migrazione che in produzione
-- non si applica. È successo con la 160.
--
-- Qui dentro ci sono due ordini, perché servono due cose diverse:
--   · `…c1` ANNULLATO  → fa scattare il riempimento della 160;
--   · `…c2` NUOVO con una riga di merce → serve a chiamare due volte
--     `restore_stock_for_order` e vedere se il magazzino somma una volta sola.
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

-- Un prodotto con dieci pezzi a scaffale.
INSERT INTO public.products (id, seller_id, name, price, stock)
VALUES ('b0000000-0000-0000-0000-0000000000a1',
        '11111111-1111-1111-1111-111111111111', 'Michetta', 1.20, 10);

-- ① L'ordine già annullato: è quello che fa scattare il riempimento.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price,
  payment_method, payment_status, delivery_status, payout_status, canceled_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000000c1',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  30.00, 'card', 'REFUNDED', 'CANCELED', 'REVERSED', now() - interval '2 hours',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

-- ② L'ordine vivo con dentro tre michette: serve a provare la doppia chiamata.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price,
  payment_method, payment_status, delivery_status, payout_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'a0000000-0000-0000-0000-0000000000c2',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  3.60, 'card', 'PAID', 'NEW', 'HELD',
  'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
);

INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
VALUES ('a0000000-0000-0000-0000-0000000000c2',
        'b0000000-0000-0000-0000-0000000000a1', 3, 1.20);

-- Il magazzino torna a dieci a mano: se un grilletto l'ha già scalato durante
-- l'inserimento, la prova partirebbe da un numero che non conosciamo.
UPDATE public.products SET stock = 10 WHERE id = 'b0000000-0000-0000-0000-0000000000a1';

RESET mycity.allow_order_write;
RESET mycity.allow_profile_write;
