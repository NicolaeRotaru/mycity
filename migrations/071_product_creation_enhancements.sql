-- 071_product_creation_enhancements.sql
-- Potenziamento della creazione annuncio (venditore).
-- Aggiunge a `products`: unità di misura, prezzo pieno barrato, condizione,
-- tag, idoneità Express per-prodotto; abilita lo stato 'draft' (bozza).
-- Aggiunge a `profiles`: offerta Express a livello negozio.
-- Tutto additivo + idempotente. I CHECK fungono da validazione lato server.

BEGIN;

-- 1) Nuove colonne prodotto --------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit             text,
  ADD COLUMN IF NOT EXISTS compare_at_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS condition        text,
  ADD COLUMN IF NOT EXISTS tags             text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS express_enabled  boolean;  -- NULL = eredita dal negozio

COMMENT ON COLUMN public.products.unit             IS 'Unità di misura del prezzo: pezzo|kg|g|l|ml|confezione|paio|m (NULL=pezzo).';
COMMENT ON COLUMN public.products.compare_at_price IS 'Prezzo pieno barrato (>= price). NULL = nessuno sconto.';
COMMENT ON COLUMN public.products.condition        IS 'Condizione: nuovo|usato|ricondizionato.';
COMMENT ON COLUMN public.products.tags             IS 'Parole chiave libere per ricerca/scoperta.';
COMMENT ON COLUMN public.products.express_enabled  IS 'Idoneità Express per prodotto. NULL=eredita da profiles.offers_express, true/false=override.';

-- Vincoli di dominio (autorità lato server). DROP+ADD per idempotenza.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_unit_check;
ALTER TABLE public.products ADD  CONSTRAINT products_unit_check
  CHECK (unit IS NULL OR unit IN ('pezzo','kg','g','l','ml','confezione','paio','m'));

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_condition_check;
ALTER TABLE public.products ADD  CONSTRAINT products_condition_check
  CHECK (condition IS NULL OR condition IN ('nuovo','usato','ricondizionato'));

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_compare_at_price_check;
ALTER TABLE public.products ADD  CONSTRAINT products_compare_at_price_check
  CHECK (compare_at_price IS NULL OR compare_at_price >= price);

-- 2) Stato 'draft' (bozza) ---------------------------------------------------
-- Il CHECK originale (mig. 001) ammette solo available/sold/pending_approval.
-- Lo ricreiamo includendo 'draft' e gli stati già citati dal trigger di
-- auto-ripubblicazione (out_of_stock/sold_out), per coerenza. Le bozze NON
-- sono pubbliche: la policy RLS pubblica richiede status='available'.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE public.products ADD  CONSTRAINT products_status_check
  CHECK (status IN ('available','sold','pending_approval','draft','out_of_stock','sold_out'));

-- 3) Express a livello negozio ----------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS offers_express boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.offers_express IS 'Il negozio offre consegna Express (default per i suoi prodotti).';

-- 4) Auto-ripubblicazione: NON ripubblicare le BOZZE al rientro dello stock --
-- Identica a mig. 032 ma rimuove 'draft' dal set ripubblicabile: una bozza
-- con stock aggiunto deve restare bozza finché il venditore non la pubblica.
CREATE OR REPLACE FUNCTION public.auto_republish_on_restock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Trigger solo se stock va da 0 a > 0
    IF OLD.stock IS DISTINCT FROM 0 OR NEW.stock IS NULL OR NEW.stock <= 0 THEN
        RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('out_of_stock','sold_out') THEN
        RETURN NEW;
    END IF;

    -- Auto-pubblica
    NEW.status := 'available';

    -- Notifica utenti che lo avevano in wishlist
    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT f.user_id, '✨ Torna disponibile!', NEW.name || ' è di nuovo in stock.', '/product/' || NEW.id
    FROM public.favorites f
    WHERE f.product_id = NEW.id;

    RETURN NEW;
END;
$$;

-- 5) Indice per ricerca/filtri sui tag --------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_tags ON public.products USING gin (tags);

COMMIT;
