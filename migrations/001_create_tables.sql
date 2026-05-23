-- Create profiles table
-- Note: store_id removed as FK reference to itself (was circular)
CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role text CHECK (role IN ('seller', 'buyer', 'pending_approval')) DEFAULT 'buyer',
    is_approved boolean DEFAULT false,
    store_name text,
    store_lat double precision,
    store_lng double precision,
    store_phone text,
    created_at timestamptz DEFAULT now()
);

-- Create products table
CREATE TABLE public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    price numeric(10, 2) NOT NULL CHECK (price >= 0),
    images jsonb DEFAULT '[]',
    seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    status text CHECK (status IN ('available', 'sold', 'pending_approval')) DEFAULT 'pending_approval',
    created_at timestamptz DEFAULT now()
);

-- Create orders table
CREATE TABLE public.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    total_price numeric(10, 2) NOT NULL CHECK (total_price >= 0),
    payment_status text CHECK (payment_status IN ('PAID', 'FAILED', 'PENDING')) DEFAULT 'PENDING',
    delivery_status text CHECK (delivery_status IN ('PREPARATION', 'SHIPPED', 'DELIVERED')) DEFAULT 'PREPARATION',
    created_at timestamptz DEFAULT now()
);

-- Create order_items join table (was missing)
CREATE TABLE public.order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(10, 2) NOT NULL
);

-- Create reviews table
CREATE TABLE public.reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    rating numeric(2, 1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment text,
    created_at timestamptz DEFAULT now()
);

-- =====================
-- Row Level Security
-- =====================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update only their own row
CREATE POLICY "Users can view their own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Profile is created on signup"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Products: approved sellers can insert; everyone can view available products
CREATE POLICY "Anyone can view available products"
    ON public.products FOR SELECT
    USING (status = 'available');

CREATE POLICY "Approved sellers can insert products"
    ON public.products FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND is_approved = true
        )
    );

CREATE POLICY "Sellers can update their own products"
    ON public.products FOR UPDATE
    USING (seller_id = auth.uid());

-- Orders: users can only see their own orders
CREATE POLICY "Users can view their own orders"
    ON public.orders FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create orders"
    ON public.orders FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Reviews: anyone can read, authenticated users can write
CREATE POLICY "Anyone can view reviews"
    ON public.reviews FOR SELECT
    USING (true);

CREATE POLICY "Authenticated users can write reviews"
    ON public.reviews FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- =====================
-- Trigger: auto-create profile on user signup
-- =====================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, role)
    VALUES (new.id, 'buyer');
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
