-- =============================================================================
-- 302 — L'Analisi del negozio conta le recensioni del negozio (R06-017, 12/11/2026)
-- =============================================================================
-- IL DIFETTO. andamento_del_negozio (migrazione 141) prendeva voto medio e numero
-- di recensioni da public.reviews unita ai prodotti del negozio. Ma i clienti
-- recensiscono il NEGOZIO (store_reviews), ed è da lì che legge la pagina
-- Recensioni. Un negozio con tre recensioni leggeva in Analisi «Nessuna
-- recensione», mentre la pagina accanto ne contava tre.
--
-- LA CORREZIONE. Voto medio e recensioni contano anche store_reviews con
-- store_id = auth.uid(), come la pagina Recensioni, insieme ai voti ai prodotti
-- che contava già la 141 (la prova 22 li pretende): la pagina Analisi scrive
-- «recensioni del negozio e dei prodotti». Tutto il resto della funzione (le
-- visite) è identico alla 141. Permessi ripetuti come nella 141.
--
-- RITORNO INDIETRO (down): rieseguire il CREATE OR REPLACE FUNCTION
-- public.andamento_del_negozio della migrazione 141. Nessun dato viene toccato.
-- =============================================================================

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
  -- «Oggi» è oggi a Piacenza, non a Greenwich: fra mezzanotte e le due le
  -- visite finivano nel giorno prima (stessa regola del difetto #221).
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
  ),
  -- I voti al negozio (quelli che legge la pagina Recensioni) e quelli ai suoi
  -- prodotti, insieme: la pagina lo dice sotto il numero.
  voti AS (
    SELECT r.rating FROM public.store_reviews r WHERE r.store_id = (SELECT auth.uid())
    UNION ALL
    SELECT r.rating FROM public.reviews r JOIN miei m ON m.id = r.product_id
  )
  SELECT
    (SELECT count(*) FROM visite)::bigint,
    (SELECT count(*) FROM visite, confini c WHERE visite.viewed_at >= c.da7)::bigint,
    (SELECT count(*) FROM visite, confini c WHERE visite.viewed_at >= c.inizio_oggi)::bigint,
    coalesce((SELECT jsonb_object_agg(product_id::text, n)
                FROM (SELECT product_id, count(*) AS n FROM visite GROUP BY product_id) x), '{}'::jsonb),
    (SELECT round(avg(voti.rating)::numeric, 2) FROM voti),
    (SELECT count(*) FROM voti)::bigint;
$$;

REVOKE ALL ON FUNCTION public.andamento_del_negozio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.andamento_del_negozio() TO authenticated;
