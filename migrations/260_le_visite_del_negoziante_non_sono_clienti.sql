-- =============================================================================
-- 260 — Le visite del negoziante e dell'amministratore non sono visite di clienti
-- =============================================================================
-- IL DIFETTO (R02-014, 12/11/2026). Il venditore che riapre la sua scheda per
-- sistemare foto e prezzo, o l'amministratore che controlla un prodotto,
-- scriveva una riga in product_views come un cliente qualunque. Quelle righe
-- finivano nelle «visite» della pagina Andamento, nel denominatore del tasso di
-- conversione e fra i «più visti» della home (ultime 24 ore).
--
-- COSA FA. Ridefinisce le due funzioni che sommano le visite, con la stessa
-- firma, gli stessi permessi e lo stesso risultato, escludendo le righe scritte
-- dal venditore del prodotto e dagli amministratori. Le visite anonime restano.
-- Il browser smette di scriverle (components/ProductViewTracker.tsx), ma le
-- righe gia' scritte, e quelle di una versione vecchia della pagina, le toglie
-- il conto qui.
--
-- COSA NON FA. Non cancella righe da product_views e non tocca il trigger di
-- deduplica.
--
-- RITORNO INDIETRO (down): riapplicare le definizioni di
--   migrations/129_il_catalogo_si_vede_senza_account.sql (trending_product_ids_24h)
--   migrations/141_i_conti_del_venditore_li_fa_il_database.sql (andamento_del_negozio)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trending_product_ids_24h(p_limit int DEFAULT 8)
RETURNS TABLE (product_id uuid, view_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  select pv.product_id, count(*)::bigint as view_count
  from public.product_views pv
  join public.products p on p.id = pv.product_id
  where pv.viewed_at >= now() - interval '24 hours'
    and (
      pv.user_id is null
      or (
        pv.user_id <> p.seller_id
        and not exists (select 1 from public.profiles a where a.id = pv.user_id and a.role = 'admin')
      )
    )
  group by pv.product_id
  order by count(*) desc
  limit greatest(coalesce(p_limit, 8), 1);
$$;

REVOKE ALL ON FUNCTION public.trending_product_ids_24h(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trending_product_ids_24h(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.andamento_del_negozio()
RETURNS TABLE (
  viste_30 bigint,
  viste_7 bigint,
  viste_oggi bigint,
  viste_per_prodotto jsonb,
  voto_medio numeric,
  recensioni bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH miei AS (
    SELECT id FROM public.products WHERE seller_id = (SELECT auth.uid())
  ),
  confini AS (
    SELECT now() - interval '30 days' AS da30,
           now() - interval '7 days'  AS da7,
           (((now() AT TIME ZONE 'Europe/Rome')::date)::timestamp AT TIME ZONE 'Europe/Rome') AS inizio_oggi
  ),
  visite AS (
    SELECT v.product_id, v.viewed_at
      FROM public.product_views v
      JOIN miei m ON m.id = v.product_id, confini c
     WHERE v.viewed_at >= c.da30
       -- 260 — le visite del negoziante stesso e degli amministratori non contano.
       AND (
         v.user_id IS NULL
         OR (
           v.user_id <> (SELECT auth.uid())
           AND NOT EXISTS (SELECT 1 FROM public.profiles a WHERE a.id = v.user_id AND a.role = 'admin')
         )
       )
  )
  SELECT
    (SELECT count(*) FROM visite)::bigint,
    (SELECT count(*) FROM visite, confini c WHERE visite.viewed_at >= c.da7)::bigint,
    (SELECT count(*) FROM visite, confini c WHERE visite.viewed_at >= c.inizio_oggi)::bigint,
    coalesce((SELECT jsonb_object_agg(product_id::text, n)
                FROM (SELECT product_id, count(*) AS n FROM visite GROUP BY product_id) x), '{}'::jsonb),
    (SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r JOIN miei m ON m.id = r.product_id),
    (SELECT count(*) FROM public.reviews r JOIN miei m ON m.id = r.product_id)::bigint;
$$;

REVOKE ALL ON FUNCTION public.andamento_del_negozio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.andamento_del_negozio() TO authenticated;
