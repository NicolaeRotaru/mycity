-- Il catalogo era invisibile a chi non ha fatto l'accesso: nessun cliente nuovo poteva comprare.
--
-- IL DIFETTO (radiografia del 27/8/2026, primo dei quattro bloccanti). Un visitatore senza account
-- leggeva ZERO prodotti, zero recensioni, zero risultati di ricerca. I negozi in home si vedevano —
-- e questo era l'inganno, il sito sembrava vivo — ma ogni scheda prodotto rispondeva «Prodotto non
-- trovato». Misurato ricostruendo il database dalle migrazioni e leggendo col ruolo `anon`, quello
-- della chiave pubblica che ha ogni browser.
--
-- LA CAUSA. La regola di lettura pubblica dei prodotti (119, righe 229-239) chiedeva «il negozio che
-- lo vende è approvato?» con un EXISTS dentro `profiles`. In PostgreSQL quella domanda viene eseguita
-- coi permessi di CHI GUARDA, non del database. E su `profiles` la lettura pubblica era stata chiusa
-- dalle migrazioni 110 e 112, per non esporre IBAN, documenti e saldo del portafoglio. Quindi per un
-- estraneo l'EXISTS era sempre falso, e nessun prodotto passava. Il difetto si propagava: `reviews`
-- chiede «il prodotto è visibile?», `store_reviews` chiede «il negozio è approvato?».
--
-- LA RIPARAZIONE. La domanda su `profiles` si sposta dentro una funzione che legge coi permessi del
-- database — come già fatto per `is_rider_approvato()` nella 114 — e che risponde solo sì o no: non
-- restituisce nessuna riga, quindi `profiles` resta chiusa esattamente com'è oggi. Le regole di
-- lettura chiamano quella funzione al posto dell'EXISTS.
--
-- REVERSIBILE. Le tre regole vecchie si ricreano con lo stesso testo, che è qui sopra nel commento e
-- nelle migrazioni 119, 109 e 114.
--
-- LA PROVA: tests/sql/rls/19-il-catalogo-si-vede-anche-senza-account.test.sql. Senza questa
-- migrazione è rossa su otto controlli, con questa è verde — e i due controlli finali verificano che
-- `profiles` e `product_views` restino chiuse riga per riga.

-- =========================================================
-- ① LE DUE DOMANDE, RISPOSTE COI PERMESSI DEL DATABASE
-- =========================================================
-- Rispondono un booleano su un id che il chiamante ha già in mano: non c'è nessun dato da estrarre
-- chiamandole in sequenza che non sia già in vetrina.

CREATE OR REPLACE FUNCTION public.negozio_approvato(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_id
       AND p.role = 'seller'
       AND p.is_approved = true
  );
$$;

-- In PostgreSQL una funzione nasce con EXECUTE concesso a PUBLIC: il divieto va scritto verso
-- PUBLIC, non verso anon/authenticated (che un permesso proprio non ce l'hanno). È l'errore che la
-- radiografia del 21/8 ha trovato ripetuto cinque volte.
REVOKE ALL ON FUNCTION public.negozio_approvato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.negozio_approvato(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.prodotto_in_vetrina(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.products pr
     WHERE pr.id = p_id
       AND pr.status = 'available'
       AND public.negozio_approvato(pr.seller_id)
  );
$$;

REVOKE ALL ON FUNCTION public.prodotto_in_vetrina(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prodotto_in_vetrina(uuid) TO anon, authenticated;

-- =========================================================
-- ② LE TRE REGOLE DI LETTURA PUBBLICA
-- =========================================================

DROP POLICY IF EXISTS "Products visible to public if seller approved" ON public.products;
CREATE POLICY "Products visible to public if seller approved"
  ON public.products FOR SELECT
  USING (
    status = 'available'
    AND public.negozio_approvato(seller_id)
  );

-- Prima: EXISTS su products con status='available'. Adesso la stessa domanda passa dalla funzione,
-- che aggiunge «e il negozio è approvato»: è la stessa condizione con cui il prodotto si vede, quindi
-- una recensione non resta visibile su un prodotto che non lo è più.
DROP POLICY IF EXISTS "Reviews readable for visible products only" ON public.reviews;
CREATE POLICY "Reviews readable for visible products only"
  ON public.reviews FOR SELECT
  USING (public.prodotto_in_vetrina(product_id));

DROP POLICY IF EXISTS "Store reviews readable for approved stores" ON public.store_reviews;
CREATE POLICY "Store reviews readable for approved stores"
  ON public.store_reviews FOR SELECT
  USING (public.negozio_approvato(store_id));

-- =========================================================
-- ③ LE FUNZIONI DI VETRINA CHE LEGGEVANO `profiles`
-- =========================================================
-- `search_products_smart` e `active_promo_products` prendevano il nome del negozio da `profiles` con
-- un JOIN: per un estraneo quel JOIN non trovava niente e la funzione tornava vuota, anche dopo la
-- riparazione delle regole qui sopra. Il nome adesso arriva da `seller_public_profiles`, la vista
-- pubblica dei negozi (già a permessi di definizione, già usata dalla home).
--
-- PERCHÉ LEFT JOIN E NON JOIN: la vista pretende anche `store_name IS NOT NULL`. Con un JOIN secco un
-- negozio approvato che non ha ancora messo l'insegna sparirebbe dalla ricerca — oggi invece compare
-- col nome vuoto. Il LEFT JOIN tiene il comportamento identico a prima; il filtro «è approvato» lo fa
-- la funzione, come nella regola dei prodotti.

CREATE OR REPLACE FUNCTION public.search_products_smart(q text, lim int DEFAULT 10)
RETURNS TABLE (
    id uuid,
    name text,
    price numeric,
    images jsonb,
    seller_id uuid,
    store_name text,
    rank real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    q_trim text := trim(q);
BEGIN
    IF q_trim = '' OR char_length(q_trim) < 1 THEN
        RETURN;
    END IF;

    IF char_length(q_trim) < 3 THEN
        -- Prefix + trigram per query molto corte
        RETURN QUERY
            SELECT
                p.id,
                p.name,
                p.price,
                p.images,
                p.seller_id,
                pr.store_name,
                similarity(p.name, q_trim) AS rank
            FROM public.products p
            LEFT JOIN public.seller_public_profiles pr ON pr.id = p.seller_id
            WHERE p.status = 'available'
              AND public.negozio_approvato(p.seller_id)
              AND (p.name ILIKE q_trim || '%' OR p.name % q_trim)
            ORDER BY rank DESC, p.name
            LIMIT lim;
    ELSE
        -- FTS websearch italiano per query 3+ char
        RETURN QUERY
            SELECT
                p.id,
                p.name,
                p.price,
                p.images,
                p.seller_id,
                pr.store_name,
                ts_rank(p.search_tsv, websearch_to_tsquery('italian', q_trim)) AS rank
            FROM public.products p
            LEFT JOIN public.seller_public_profiles pr ON pr.id = p.seller_id
            WHERE p.status = 'available'
              AND public.negozio_approvato(p.seller_id)
              AND (
                p.search_tsv @@ websearch_to_tsquery('italian', q_trim)
                OR p.name % q_trim  -- fallback trigram fuzzy
              )
            ORDER BY rank DESC NULLS LAST, p.name
            LIMIT lim;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.active_promo_products(p_limit int DEFAULT 12, p_seller uuid DEFAULT NULL)
RETURNS TABLE (
    product_id uuid,
    name text,
    price numeric,
    images jsonb,
    seller_id uuid,
    store_name text,
    discount_percent int,
    stock int,
    has_variants boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        p.id AS product_id,
        p.name,
        p.price,
        p.images,
        p.seller_id,
        pr.store_name,
        MAX(sp.discount_percent)::int AS discount_percent,
        p.stock,
        p.has_variants
    FROM public.products p
    LEFT JOIN public.seller_public_profiles pr ON pr.id = p.seller_id
    JOIN public.seller_promotions sp
        ON sp.seller_id = p.seller_id
       AND sp.status = 'active'
       AND sp.starts_at <= now()
       AND sp.ends_at >= now()
       AND (
            sp.scope = 'store'
         OR (sp.scope = 'category' AND sp.category_id = p.category_id)
         OR (sp.scope = 'products' AND p.id = ANY(sp.product_ids))
       )
    WHERE p.status = 'available'
      AND public.negozio_approvato(p.seller_id)
      AND (p_seller IS NULL OR p.seller_id = p_seller)
    GROUP BY p.id, p.name, p.price, p.images, p.seller_id, pr.store_name, p.stock, p.has_variants
    ORDER BY discount_percent DESC, p.id
    LIMIT GREATEST(p_limit, 1);
$$;

-- =========================================================
-- ④ LA FASCIA «I PIÙ VISTI»
-- =========================================================
-- Legge `product_views`, che a un estraneo è chiusa riga per riga — ed è giusto che lo resti: dice
-- chi ha guardato cosa e quando. Ma il conteggio aggregato è materiale da vetrina. La funzione passa
-- ai permessi del database e restituisce SOLO id e numero di visite: nessuna riga, nessun utente,
-- nessun orario.

CREATE OR REPLACE FUNCTION public.trending_product_ids_24h(p_limit int DEFAULT 8)
RETURNS TABLE (product_id uuid, view_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  select pv.product_id, count(*)::bigint as view_count
  from public.product_views pv
  where pv.viewed_at >= now() - interval '24 hours'
  group by pv.product_id
  order by count(*) desc
  limit greatest(coalesce(p_limit, 8), 1);
$$;

REVOKE ALL ON FUNCTION public.trending_product_ids_24h(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trending_product_ids_24h(int) TO anon, authenticated;
