-- 080: Varianti prodotto (es. taglie/colori dello stesso capo) con stock proprio.
--
-- Caso d'uso: un vestito disponibile in più taglie e/o colori, ognuna con la
-- propria disponibilità. Il prezzo resta unico a livello prodotto (decisione di
-- prodotto: stesso prezzo per tutte le varianti); ogni variante ha SOLO il suo
-- stock e l'etichetta delle opzioni.
--
-- Integrità inventario: lo stock per-variante è rispettato lungo tutta la catena
-- (pagina prodotto → carrello → checkout → reserve_stock → order_items). Le RPC
-- esistenti (062) sono estese per accettare un `variant_id` opzionale; senza di
-- esso il comportamento è IDENTICO a prima (prodotti senza varianti invariati).
--
-- products.stock viene tenuto allineato alla somma degli stock delle varianti da
-- un trigger, così tutte le viste esistenti (card, badge "ultimi N", esaurito)
-- continuano a funzionare senza modifiche.

-- 1. Tabella varianti -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- Opzioni come coppie chiave→valore, es. {"taglia":"M","colore":"Bianco"}.
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Etichetta leggibile precompilata dal client, es. "M · Bianco".
  label text NOT NULL DEFAULT '',
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_variants_product_id_idx ON public.product_variants(product_id);

-- Flag denormalizzato sul prodotto: evita JOIN nelle liste (card) per sapere se
-- il prodotto ha varianti (→ scelta opzione obbligatoria prima dell'acquisto).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS has_variants boolean NOT NULL DEFAULT false;

-- 2. order_items: collega la variante acquistata -----------------------------
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_label text;

-- 3. RLS ---------------------------------------------------------------------
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- Lettura pubblica: le varianti seguono la visibilità del prodotto (che è già
-- gated dalla RLS di products). Da sole non espongono dati sensibili.
DROP POLICY IF EXISTS product_variants_select ON public.product_variants;
CREATE POLICY product_variants_select ON public.product_variants
  FOR SELECT USING (true);

-- Scrittura: solo il venditore proprietario del prodotto.
DROP POLICY IF EXISTS product_variants_modify ON public.product_variants;
CREATE POLICY product_variants_modify ON public.product_variants
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_variants.product_id AND p.seller_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_variants.product_id AND p.seller_id = auth.uid()));

GRANT SELECT ON public.product_variants TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;

-- 4. Rollup: products.stock = somma stock varianti, e has_variants -----------
CREATE OR REPLACE FUNCTION public.sync_product_variant_rollup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid; v_count int; v_sum int;
BEGIN
  v_pid := COALESCE(NEW.product_id, OLD.product_id);
  SELECT count(*), COALESCE(sum(stock), 0) INTO v_count, v_sum
    FROM public.product_variants WHERE product_id = v_pid;
  UPDATE public.products
    SET has_variants = (v_count > 0),
        -- Con varianti: stock = somma. Senza (ultima variante rimossa): invariato.
        stock = CASE WHEN v_count > 0 THEN v_sum ELSE stock END
    WHERE id = v_pid;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_product_variant_rollup ON public.product_variants;
CREATE TRIGGER trg_sync_product_variant_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_variant_rollup();

-- Funzione di trigger: mai esposta come RPC. Si revoca anche da PUBLIC (il
-- grant di default), altrimenti anon/authenticated la erediterebbero comunque.
-- Il trigger continua a scattare a prescindere (gira come definer).
REVOKE ALL ON FUNCTION public.sync_product_variant_rollup() FROM PUBLIC, anon, authenticated;

-- 5. reserve/restore stock: variant-aware (retro-compatibili) ----------------
-- Quando l'item ha variant_id, decrementa/ripristina la variante (il trigger
-- riallinea products.stock). Senza variant_id, comportamento identico a 062.
CREATE OR REPLACE FUNCTION public.reserve_stock(p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it jsonb; v_pid uuid; v_vid uuid; v_qty int; v_updated int;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid := (it->>'product_id')::uuid;
    v_vid := NULLIF(it->>'variant_id', '')::uuid;
    v_qty := (it->>'qty')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    IF v_vid IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock - v_qty
        WHERE id = v_vid AND product_id = v_pid AND stock >= v_qty;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        RAISE EXCEPTION 'OUT_OF_STOCK:%', v_vid USING ERRCODE = '23514';
      END IF;
    ELSE
      IF v_pid IS NULL THEN CONTINUE; END IF;
      UPDATE public.products
        SET stock = stock - v_qty
        WHERE id = v_pid AND (stock IS NULL OR stock >= v_qty);
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        RAISE EXCEPTION 'OUT_OF_STOCK:%', v_pid USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.restore_stock(p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it jsonb; v_vid uuid;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_vid := NULLIF(it->>'variant_id', '')::uuid;
    IF v_vid IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock + (it->>'qty')::int
        WHERE id = v_vid;
    ELSE
      UPDATE public.products
        SET stock = stock + (it->>'qty')::int
        WHERE id = (it->>'product_id')::uuid AND stock IS NOT NULL;
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.restore_stock_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Righe con variante → ripristina la variante.
  UPDATE public.product_variants v
    SET stock = v.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.variant_id = v.id;
  -- Righe senza variante → ripristina il prodotto (come 062).
  UPDATE public.products p
    SET stock = p.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.product_id = p.id
    AND oi.variant_id IS NULL
    AND p.stock IS NOT NULL;
END; $$;

REVOKE ALL ON FUNCTION public.reserve_stock(jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_stock(jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_stock_for_order(uuid) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
