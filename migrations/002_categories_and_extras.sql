-- =====================
-- Categories
-- =====================
CREATE TABLE public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    name text NOT NULL,
    parent_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
    icon text,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view categories"
    ON public.categories FOR SELECT
    USING (true);

-- =====================
-- Estensioni: products e profiles
-- =====================
ALTER TABLE public.products
    ADD COLUMN category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
    ADD COLUMN stock integer DEFAULT 0 CHECK (stock >= 0);

ALTER TABLE public.profiles
    ADD COLUMN full_name text,
    ADD COLUMN phone text,
    ADD COLUMN address text,
    ADD COLUMN city text,
    ADD COLUMN zip text;

-- =====================
-- Policy aggiuntive
-- =====================

-- Sellers: vedono ed eliminano i propri prodotti (anche se non available)
CREATE POLICY "Sellers can view their own products"
    ON public.products FOR SELECT
    USING (seller_id = auth.uid());

CREATE POLICY "Sellers can delete their own products"
    ON public.products FOR DELETE
    USING (seller_id = auth.uid());

-- Sellers: vedono ordini contenenti i propri prodotti e ne aggiornano lo stato consegna
CREATE POLICY "Sellers can view orders of their products"
    ON public.orders FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.order_items oi
            JOIN public.products p ON p.id = oi.product_id
            WHERE oi.order_id = orders.id AND p.seller_id = auth.uid()
        )
    );

CREATE POLICY "Sellers can update orders of their products"
    ON public.orders FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.order_items oi
            JOIN public.products p ON p.id = oi.product_id
            WHERE oi.order_id = orders.id AND p.seller_id = auth.uid()
        )
    );

-- order_items: il buyer vede/inserisce i propri; il seller vede quelli che includono i suoi prodotti
CREATE POLICY "Users can view their own order_items"
    ON public.order_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE id = order_items.order_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert their own order_items"
    ON public.order_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE id = order_items.order_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Sellers can view order_items of their products"
    ON public.order_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.products
            WHERE id = order_items.product_id AND seller_id = auth.uid()
        )
    );

-- =====================
-- Seed categorie principali
-- =====================
INSERT INTO public.categories (slug, name, icon) VALUES
    ('alimentari',    'Alimentari',     '🍎'),
    ('abbigliamento', 'Abbigliamento',  '👕'),
    ('casa',          'Casa & Cucina',  '🏠'),
    ('elettronica',   'Elettronica',    '💻'),
    ('libri',         'Libri',          '📚'),
    ('giardino',      'Giardino',       '🌱'),
    ('bellezza',      'Bellezza',       '💄'),
    ('sport',         'Sport',          '⚽');

-- Sottocategorie esempio
INSERT INTO public.categories (slug, name, parent_id)
SELECT 'frutta-verdura', 'Frutta e Verdura', id FROM public.categories WHERE slug = 'alimentari';
INSERT INTO public.categories (slug, name, parent_id)
SELECT 'panificio',      'Panificio',        id FROM public.categories WHERE slug = 'alimentari';
INSERT INTO public.categories (slug, name, parent_id)
SELECT 'salumeria',      'Salumeria',        id FROM public.categories WHERE slug = 'alimentari';
INSERT INTO public.categories (slug, name, parent_id)
SELECT 'uomo',           'Uomo',             id FROM public.categories WHERE slug = 'abbigliamento';
INSERT INTO public.categories (slug, name, parent_id)
SELECT 'donna',          'Donna',            id FROM public.categories WHERE slug = 'abbigliamento';
INSERT INTO public.categories (slug, name, parent_id)
SELECT 'bambini',        'Bambini',          id FROM public.categories WHERE slug = 'abbigliamento';

-- =====================
-- Storage bucket per immagini prodotti
-- =====================
INSERT INTO storage.buckets (id, name, public) VALUES ('products', 'products', true)
    ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view product images"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'products');

CREATE POLICY "Authenticated users can upload product images"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'products' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update their own product images"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'products' AND owner = auth.uid());

CREATE POLICY "Users can delete their own product images"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'products' AND owner = auth.uid());
