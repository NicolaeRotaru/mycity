-- =============================================================================
-- 301 — La classifica del negozio del mese usa il mese di Piacenza (R06-014, 12/11/2026)
-- =============================================================================
-- IL DIFETTO. La vista shop_of_month_leaderboard (migrazione 034) prende il mese
-- con DATE_TRUNC('month', now()) nel fuso del database (UTC), mentre chi vota e la
-- pagina dell'amministrazione usano il mese di Piacenza (primoDelMesePiacenza).
-- Nella prima ora del mese (le prime due d'estate) la classifica contava il mese
-- prima e ignorava i voti appena dati.
--
-- LA CORREZIONE. Il mese si calcola su now() AT TIME ZONE 'Europe/Rome'. Il resto
-- della vista è identico; le opzioni di oggi (121 e 152, ribadite dalla 161)
-- si ripetono qui perché CREATE OR REPLACE non le lasci cadere. I permessi su
-- una vista sostituita restano.
--
-- RITORNO INDIETRO (down): rieseguire il CREATE OR REPLACE VIEW della 034 e poi
-- ALTER VIEW public.shop_of_month_leaderboard SET (security_invoker = off, security_barrier = true);
-- Nessun dato viene toccato.
-- =============================================================================

CREATE OR REPLACE VIEW public.shop_of_month_leaderboard
WITH (security_invoker = off, security_barrier = true) AS
SELECT
    p.id AS seller_id,
    p.store_name,
    p.store_logo,
    DATE_TRUNC('month', now() AT TIME ZONE 'Europe/Rome')::date AS month,
    COUNT(v.id) AS vote_count
FROM public.profiles p
LEFT JOIN public.shop_of_month_votes v ON v.seller_id = p.id
    AND v.month = DATE_TRUNC('month', now() AT TIME ZONE 'Europe/Rome')::date
WHERE p.role = 'seller' AND p.is_approved = true
GROUP BY p.id, p.store_name, p.store_logo
ORDER BY vote_count DESC, p.store_name
LIMIT 50;

ALTER VIEW public.shop_of_month_leaderboard SET (security_invoker = off, security_barrier = true);
