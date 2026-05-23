-- 018: FK orders.user_id → profiles.id + sicurezza colonne 017
--
-- Bug: orders.user_id ha la FK verso auth.users (dalla 001), quindi
-- PostgREST non riesce a embed `profiles!orders_user_id_fkey(...)`
-- → 400 Bad Request sulle query con join al buyer.
--
-- Fix: drop e ri-crea la FK puntando a profiles (profiles.id = auth.users.id
-- per design, percio' tutti i valori esistenti restano validi).
--
-- Idempotente.

-- 1) Sicurezza: ri-aggiungo le colonne della 017 se per qualche motivo non ci sono
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS store_media jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS store_description text;

-- 2) Drop e re-create della FK orders.user_id → profiles.id
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_user_id_fkey;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE SET NULL;

-- 3) Re-affermo le policy SELECT critiche (idempotente)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view available products" ON public.products;
CREATE POLICY "Anyone can view available products"
  ON public.products FOR SELECT
  USING (status = 'available');

DROP POLICY IF EXISTS "Anyone can view approved seller profiles" ON public.profiles;
CREATE POLICY "Anyone can view approved seller profiles"
  ON public.profiles FOR SELECT
  USING (is_approved = true AND store_name IS NOT NULL);

-- 4) Reload schema PostgREST
NOTIFY pgrst, 'reload schema';

-- 5) Verifica
SELECT 'colonna store_media presente'    AS check, count(*)::text AS valore
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles' AND column_name='store_media'
UNION ALL
SELECT 'FK orders.user_id → profiles?',
       CASE WHEN confrelid = 'public.profiles'::regclass THEN 'OK' ELSE 'NO' END
  FROM pg_constraint
  WHERE conname = 'orders_user_id_fkey'
UNION ALL
SELECT 'profili seller approvati',  count(*)::text FROM public.profiles WHERE is_approved=true AND store_name IS NOT NULL
UNION ALL
SELECT 'prodotti available',        count(*)::text FROM public.products WHERE status='available';
