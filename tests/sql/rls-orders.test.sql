-- RLS test: buyer A NON deve poter leggere ordini buyer B
-- Esperti: Security Engineer: "RLS è il firewall #1. Senza test SQL, blast radius
-- dell'enforcement è ignoto. Test SQL = source of truth."
--
-- Run su Supabase SQL Editor (anche su test project) o psql con role authenticated.
-- Atteso: ogni query "ALTRUI" deve dare 0 rows.

-- Setup test users
DO $$
DECLARE
    user_a_id uuid := '00000000-0000-0000-0000-00000000aaaa';
    user_b_id uuid := '00000000-0000-0000-0000-00000000bbbb';
BEGIN
    -- Insert test profiles
    INSERT INTO auth.users (id, email) VALUES
        (user_a_id, 'test-a@example.com'),
        (user_b_id, 'test-b@example.com')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.profiles (id, role) VALUES
        (user_a_id, 'buyer'),
        (user_b_id, 'buyer')
    ON CONFLICT DO NOTHING;
END $$;

-- Buyer A pubblica un ordine
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000aaaa","role":"authenticated"}';
INSERT INTO public.orders (user_id, total_price, payment_status, delivery_status)
VALUES ('00000000-0000-0000-0000-00000000aaaa', 25.00, 'PAID', 'NEW')
RETURNING id, user_id;

-- Buyer B tenta di leggere ordini di Buyer A — ATTESO: 0 ROWS (RLS deny)
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000bbbb","role":"authenticated"}';
SELECT count(*) AS should_be_zero FROM public.orders
WHERE user_id = '00000000-0000-0000-0000-00000000aaaa';
-- ✅ PASS se count = 0
-- ❌ FAIL se count > 0 → RLS broken

-- Cleanup
DELETE FROM public.orders WHERE user_id IN (
    '00000000-0000-0000-0000-00000000aaaa',
    '00000000-0000-0000-0000-00000000bbbb'
);
