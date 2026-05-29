-- =============================================================================
-- 052 — RPC di aggregazione (Step 8 performance: elimina N+1 / loop lato client)
-- =============================================================================
-- Le pagine catalogo/negozi calcolavano media e conteggio di reviews/store_reviews
-- e il trending da product_views con loop nel browser (scaricando tutte le righe).
-- Le spostiamo in 3 funzioni di aggregazione server-side.
--
-- Tutte SECURITY INVOKER: rispettano la RLS già attiva su reviews/store_reviews/
-- product_views (oggi leggibili da anon/authenticated, infatti il client le
-- interroga direttamente) → nessun privilegio aggiuntivo, niente advisor
-- security_definer. search_path fisso (no function_search_path_mutable).

create or replace function public.product_rating_stats(p_product_ids uuid[])
returns table(product_id uuid, avg numeric, count integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.product_id, avg(r.rating)::numeric as avg, count(*)::int as count
  from public.reviews r
  where r.product_id = any(p_product_ids)
  group by r.product_id;
$$;

create or replace function public.store_review_stats(p_store_ids uuid[])
returns table(store_id uuid, avg numeric, count integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select sr.store_id, avg(sr.rating)::numeric as avg, count(*)::int as count
  from public.store_reviews sr
  where sr.store_id = any(p_store_ids)
  group by sr.store_id;
$$;

create or replace function public.trending_product_ids_24h(p_limit int default 8)
returns table(product_id uuid, view_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select pv.product_id, count(*)::bigint as view_count
  from public.product_views pv
  where pv.viewed_at >= now() - interval '24 hours'
  group by pv.product_id
  order by count(*) desc
  limit greatest(coalesce(p_limit, 8), 1);
$$;

-- Esposizione PostgREST: solo i ruoli client (leggono dati già pubblici).
revoke all on function public.product_rating_stats(uuid[]) from public;
revoke all on function public.store_review_stats(uuid[]) from public;
revoke all on function public.trending_product_ids_24h(int) from public;
grant execute on function public.product_rating_stats(uuid[]) to anon, authenticated;
grant execute on function public.store_review_stats(uuid[]) to anon, authenticated;
grant execute on function public.trending_product_ids_24h(int) to anon, authenticated;

notify pgrst, 'reload schema';
