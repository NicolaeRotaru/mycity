-- I due conti del pannello venditore si facevano nel browser, scaricando decine di migliaia di righe.
--
-- IL DIFETTO (radiografia del 27/8/2026, R070 e R071). Due letture portavano i dati al codice invece
-- di portare il calcolo ai dati, e tutte e due sbagliavano per difetto proprio quando i numeri
-- cominciano a contare.
--
--   · R070 — «Venduti» nella pagina Prodotti: `app/seller/products/page.tsx` scaricava OGNI riga
--     d'ordine consegnata del negozio, da sempre, senza filtro di data e senza limite, e le sommava
--     nel browser. PostgREST tronca a mille righe quando nessuno chiede un limite: superate le mille
--     righe consegnate, «Venduti» comincia a mostrare numeri più bassi del vero. Non un errore: una
--     bugia silenziosa a chi deve decidere cosa riordinare.
--
--   · R071 — «Andamento»: `app/seller/analytics/page.tsx` portava nel browser TUTTE le visite ai
--     prodotti degli ultimi 30 giorni, mille righe per volta, fino a ventimila, per mostrare tre
--     numeri. Un negozio con ventimila visite in un mese — cioè un negozio che sta andando bene —
--     faceva venti richieste in fila dal telefono. Oltre le ventimila il conteggio si fermava e
--     sbagliava per difetto. Nella stessa lettura le recensioni (`reviews`) venivano lette senza
--     limite: quelle si fermavano a mille in silenzio.
--
-- LA RIPARAZIONE. Due funzioni che contano nel database e restituiscono il risultato, non i dati.
-- L'indice giusto per le visite esiste già (`product_views_product_time_idx`, migrazione 027).
--
-- IL NEGOZIO NON SI PASSA COME PARAMETRO: lo prendono da `auth.uid()`. Il referto proponeva
-- `venduti_per_prodotto(p_seller uuid, ...)`, ma un identificativo di negozio passato dal browser è
-- un identificativo che qualcuno può cambiare — e queste funzioni girano coi permessi del
-- proprietario. Chiedendolo a chi ha fatto l'accesso, la domanda «di chi sono questi numeri?» non ha
-- risposte diverse da quella giusta.
--
-- REVERSIBILE: `DROP FUNCTION public.venduti_per_prodotto(uuid[]);` e
-- `DROP FUNCTION public.andamento_del_negozio();`. Le pagine tornano alle letture di prima.
--
-- LA PROVA: tests/sql/rls/22-i-conti-del-venditore-non-si-fermano-a-mille.test.sql — un negozio con
-- 1.200 righe consegnate e 25.000 visite. Prima erano 1.000 e 20.000; adesso sono quelli veri.

-- =========================================================
-- ① QUANTI PEZZI HO VENDUTO DI OGNI PRODOTTO
-- =========================================================
CREATE OR REPLACE FUNCTION public.venduti_per_prodotto(p_products uuid[])
RETURNS TABLE (product_id uuid, venduti bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT oi.product_id, sum(oi.quantity)::bigint AS venduti
    FROM public.order_items oi
    JOIN public.orders   o ON o.id = oi.order_id
    JOIN public.products p ON p.id = oi.product_id
   WHERE oi.product_id = ANY(p_products)
     AND p.seller_id = (SELECT auth.uid())
     AND o.delivery_status = 'DELIVERED'
   GROUP BY oi.product_id;
$$;

REVOKE ALL ON FUNCTION public.venduti_per_prodotto(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venduti_per_prodotto(uuid[]) TO authenticated;

-- =========================================================
-- ② L'ANDAMENTO DEL NEGOZIO: VISITE E VOTO, CONTATI QUI
-- =========================================================
-- Una riga sola. `viste_per_prodotto` è un oggetto {id prodotto: visite} con i
-- soli prodotti visti almeno una volta: chi non c'è ha zero visite, che è
-- esattamente quello che la pagina deve mostrare.
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
