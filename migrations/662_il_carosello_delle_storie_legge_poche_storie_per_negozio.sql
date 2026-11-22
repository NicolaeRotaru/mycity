-- =============================================================================
-- 662 — Il carosello delle storie legge poche storie PER NEGOZIO, in una lettura sola
-- =============================================================================
-- Il difetto: il carosello della home leggeva le storie più recenti in fila per data (poi a turno
-- fra i negozi). Con un negozio, o tre, da più di 30 storie nelle 24 ore, le storie degli altri
-- negozi restavano fuori dalla lettura: ogni correzione lato sito spostava solo il numero di
-- negozi che bastavano a riempirla (e un ciclo di riletture non può essere senza tetto).
--
-- La cura: una funzione che restituisce al massimo `p_per_negozio` storie per ogni negozio e al
-- massimo `p_negozi` negozi (quelli con la storia più recente). Il sito la chiama con `.rpc`, poi
-- alterna i negozi e taglia a 30. Se la funzione non c'è ancora (migrazione non applicata) il sito
-- legge come prima.
--
-- Stesse regole di oggi:
--   · SECURITY INVOKER: le storie si leggono con la regola di lettura della tabella
--     (seller_stories_public_read: solo le non scadute; il proprietario legge anche le sue);
--   · il negozio viene dalla vista pubblica `seller_public_profiles` (approvati, con insegna, di
--     ruolo negozio), come l'aggancio `!inner` di oggi;
--   · si tengono solo le storie con `expires_at > now()`, ordinate per `created_at` decrescente.
-- search_path fisso; i parametri sono limitati (1..30 storie per negozio, 1..30 negozi).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.storie_attive_per_negozio(
  p_per_negozio integer DEFAULT 30,
  p_negozi integer DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  seller_id uuid,
  image_url text,
  caption text,
  link_url text,
  view_count integer,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH vive AS (
    SELECT s.id, s.seller_id, s.image_url, s.caption, s.link_url, s.view_count, s.expires_at, s.created_at,
           row_number() OVER (PARTITION BY s.seller_id ORDER BY s.created_at DESC, s.id) AS posto,
           max(s.created_at) OVER (PARTITION BY s.seller_id) AS ultima
      FROM public.seller_stories s
      JOIN public.seller_public_profiles n ON n.id = s.seller_id
     WHERE s.expires_at > now()
  ),
  negozi AS (
    SELECT v.seller_id, row_number() OVER (ORDER BY max(v.ultima) DESC, v.seller_id) AS giro
      FROM vive v
     GROUP BY v.seller_id
  )
  SELECT v.id, v.seller_id, v.image_url, v.caption, v.link_url, v.view_count, v.expires_at, v.created_at
    FROM vive v
    JOIN negozi g ON g.seller_id = v.seller_id
   WHERE v.posto <= least(greatest(coalesce(p_per_negozio, 30), 1), 30)
     AND g.giro <= least(greatest(coalesce(p_negozi, 30), 1), 30)
   ORDER BY v.created_at DESC, v.id;
$$;

REVOKE ALL ON FUNCTION public.storie_attive_per_negozio(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storie_attive_per_negozio(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storie_attive_per_negozio(integer, integer) TO anon, authenticated;

COMMENT ON FUNCTION public.storie_attive_per_negozio(integer, integer) IS
  'R04: le storie non scadute dei negozi in vetrina, al massimo p_per_negozio per negozio e p_negozi negozi (i più recenti). Per il carosello della home.';
