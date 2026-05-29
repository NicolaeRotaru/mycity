-- =============================================================================
-- 048 — Fix advisor ERROR: viste SECURITY DEFINER nei leaderboard
-- =============================================================================
-- shop_of_month_leaderboard e referral_leaderboard erano viste SECURITY DEFINER
-- (default), segnalate come ERROR dall'advisor Supabase perché bypassano la RLS
-- del chiamante.
--
-- shop_of_month_leaderboard: i dati sottostanti sono GIÀ pubblici
-- (shop_of_month_votes ha una policy SELECT pubblica; i profili venditore
-- approvati sono pubblici), quindi basta renderla security_invoker — stesso
-- risultato, nessun bypass di RLS.
ALTER VIEW public.shop_of_month_leaderboard SET (security_invoker = on);

-- referral_leaderboard: aggrega `referrals`, che la RLS espone solo al
-- proprietario; in modalità invoker il leaderboard si romperebbe (ognuno
-- vedrebbe solo i propri). Spostiamo l'aggregazione privilegiata in una
-- funzione SECURITY DEFINER con search_path fisso, e la vista diventa un
-- wrapper security_invoker: l'advisor non la segnala più, il client continua a
-- usare .from('referral_leaderboard') (nessuna rottura) e i dati sono identici.
CREATE OR REPLACE FUNCTION public.get_referral_leaderboard()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  store_name text,
  total_referrals bigint,
  converted_referrals bigint,
  month timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.full_name,
    p.store_name,
    count(r.id),
    count(r.id) FILTER (WHERE r.status = ANY (ARRAY['first_order', 'rewarded'])),
    date_trunc('month', now())
  FROM public.profiles p
  LEFT JOIN public.referrals r
    ON r.referrer_id = p.id
   AND r.created_at >= date_trunc('month', now())
  GROUP BY p.id, p.full_name, p.store_name
  HAVING count(r.id) > 0
  ORDER BY count(r.id) FILTER (WHERE r.status = ANY (ARRAY['first_order', 'rewarded'])) DESC,
           count(r.id) DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.get_referral_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_leaderboard() TO anon, authenticated;

CREATE OR REPLACE VIEW public.referral_leaderboard WITH (security_invoker = on) AS
  SELECT user_id, full_name, store_name, total_referrals, converted_referrals, month
  FROM public.get_referral_leaderboard();

NOTIFY pgrst, 'reload schema';
