-- 011: sistema di delivery completo
--
-- Aggiunge:
-- - Ruolo 'rider' tra i possibili role
-- - Campi su orders: seller_id, rider_id, indirizzo consegna, posizione live rider, timestamp
-- - Nuovo set di stati delivery: NEW, ACCEPTED, READY, ASSIGNED, PICKED_UP, OUT_FOR_DELIVERY, DELIVERED, CANCELED
-- - RLS per: rider vede ordini disponibili + suoi; rider aggiorna posizione + assegnazione
-- - Realtime publication su orders (per il tracking live)
--
-- Idempotente.

-- 1) Allarga il ruolo
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('seller', 'buyer', 'rider', 'pending_approval'));

-- 2) Trigger handle_new_user: aggiunge supporto al ruolo 'rider'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    role_choice text;
BEGIN
    role_choice := COALESCE(new.raw_user_meta_data->>'role', 'buyer');
    INSERT INTO public.profiles (id, role, is_approved)
    VALUES (
        new.id,
        CASE
          WHEN role_choice = 'seller' THEN 'seller'
          WHEN role_choice = 'rider'  THEN 'rider'
          ELSE 'buyer'
        END,
        CASE WHEN role_choice IN ('seller', 'rider') THEN true ELSE false END
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) Allarga lo stato consegna a tutto il ciclo di vita
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_delivery_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_status_check
  CHECK (delivery_status IN (
    'NEW',              -- appena creato dal buyer, in attesa che il seller accetti
    'ACCEPTED',         -- seller ha accettato, sta preparando
    'READY',            -- pronto per il pickup, disponibile per i rider
    'ASSIGNED',         -- un rider l'ha preso in carico, va verso il negozio
    'PICKED_UP',        -- rider ha ritirato dal negozio
    'OUT_FOR_DELIVERY', -- rider in consegna verso il buyer
    'DELIVERED',        -- consegnato
    'CANCELED'          -- annullato
  ));

-- 4) Mappa i vecchi stati ai nuovi
UPDATE public.orders SET delivery_status = 'ACCEPTED'        WHERE delivery_status = 'PREPARATION';
UPDATE public.orders SET delivery_status = 'OUT_FOR_DELIVERY' WHERE delivery_status = 'SHIPPED';

-- Cambia il default
ALTER TABLE public.orders
  ALTER COLUMN delivery_status SET DEFAULT 'NEW';

-- 5) Nuove colonne su orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS seller_id              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rider_id               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_full_name     text,
  ADD COLUMN IF NOT EXISTS delivery_phone         text,
  ADD COLUMN IF NOT EXISTS delivery_address       text,
  ADD COLUMN IF NOT EXISTS delivery_city          text,
  ADD COLUMN IF NOT EXISTS delivery_zip           text,
  ADD COLUMN IF NOT EXISTS delivery_notes         text,
  ADD COLUMN IF NOT EXISTS delivery_lat           double precision,
  ADD COLUMN IF NOT EXISTS delivery_lng           double precision,
  ADD COLUMN IF NOT EXISTS shipping_cost          numeric(10, 2) DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS rider_lat              double precision,
  ADD COLUMN IF NOT EXISTS rider_lng              double precision,
  ADD COLUMN IF NOT EXISTS rider_position_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at            timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at               timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_at           timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at           timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at            timestamptz;

-- Backfill seller_id per ordini storici (un ordine puo' avere prodotti di piu' seller;
-- prendiamo il primo seller incontrato)
UPDATE public.orders o
SET seller_id = sub.seller_id
FROM (
  SELECT DISTINCT ON (oi.order_id) oi.order_id, p.seller_id
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE p.seller_id IS NOT NULL
  ORDER BY oi.order_id, oi.id
) sub
WHERE o.id = sub.order_id AND o.seller_id IS NULL;

CREATE INDEX IF NOT EXISTS orders_seller_status_idx ON public.orders(seller_id, delivery_status);
CREATE INDEX IF NOT EXISTS orders_rider_status_idx  ON public.orders(rider_id,  delivery_status);

-- 6) RLS: aggiorna le policy per il nuovo flow
-- Seller vede e aggiorna gli ordini del proprio negozio (via seller_id)
DROP POLICY IF EXISTS "Sellers can view orders of their products" ON public.orders;
DROP POLICY IF EXISTS "Sellers can update orders of their products" ON public.orders;

DROP POLICY IF EXISTS "Sellers can view their store orders" ON public.orders;
CREATE POLICY "Sellers can view their store orders"
  ON public.orders FOR SELECT
  USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "Sellers can update their store orders" ON public.orders;
CREATE POLICY "Sellers can update their store orders"
  ON public.orders FOR UPDATE
  USING (seller_id = auth.uid());

-- Rider vede ordini READY senza rider (disponibili da prendere) e quelli assegnati a lui
DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;
CREATE POLICY "Riders can view available and own orders"
  ON public.orders FOR SELECT
  USING (
    (delivery_status = 'READY' AND rider_id IS NULL)
    OR rider_id = auth.uid()
  );

-- Rider puo' aggiornare ordini assegnati a se' OPPURE prendere un ordine READY libero
DROP POLICY IF EXISTS "Riders can update assigned or claim free orders" ON public.orders;
CREATE POLICY "Riders can update assigned or claim free orders"
  ON public.orders FOR UPDATE
  USING (
    rider_id = auth.uid()
    OR (delivery_status = 'READY' AND rider_id IS NULL)
  );

-- 7) Estensione order_items: il rider deve poter vedere i prodotti dell'ordine assegnato
DROP POLICY IF EXISTS "Riders can view order_items of assigned orders" ON public.order_items;
CREATE POLICY "Riders can view order_items of assigned orders"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = order_items.order_id AND rider_id = auth.uid()
    )
  );

-- 8) profiles: rider deve poter vedere i dati del negozio (seller) e del buyer dell'ordine assegnato
-- I seller approvati sono gia' pubblici (policy 006). Per il buyer serve una policy ad-hoc:
DROP POLICY IF EXISTS "Riders can view buyer of assigned orders" ON public.profiles;
CREATE POLICY "Riders can view buyer of assigned orders"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE user_id = profiles.id AND rider_id = auth.uid()
    )
  );

-- 9) Realtime: pubblica orders cosi' il buyer puo' fare subscribe ai cambi (posizione rider)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.orders';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
