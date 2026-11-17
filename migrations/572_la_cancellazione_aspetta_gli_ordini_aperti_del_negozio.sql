-- 572: R33-014 — La cancellazione di un negozio aspetta i suoi ordini aperti e i soldi da incassare.
--
-- Il giro notturno (app/api/cron/process-deletions) prende in carico le richieste di
-- cancellazione scadute da 7 giorni che gli restituisce `process_expired_deletions()`.
-- La funzione (migrazione 040) guardava solo la data: un negozio con un ordine ancora da
-- consegnare, o con un bonifico ancora da ricevere, veniva preso in carico e cancellato
-- come gli altri. Il cliente restava con un ordine pagato senza più il negozio, e i soldi
-- del negozio senza più nessuno a cui versarli.
--
-- Adesso la funzione non restituisce chi ha ancora, come negozio:
--   · un ordine aperto: non consegnato e non annullato, pagato (o in contanti, che si
--     pagano alla consegna) — un carrello mai pagato non ferma niente;
--   · soldi da incassare: un bonifico del negozio ancora trattenuto, in attesa del conto
--     Stripe, in corso o fallito, o contanti del negozio non ancora versati dal fattorino.
-- La richiesta resta com'è (deletion_requested_at non si tocca): ogni notte si riguarda,
-- e la cancellazione parte la prima notte in cui ordini e soldi sono chiusi. Il giro
-- segnala agli amministratori chi resta in attesa (vedi la rotta).
--
-- Permessi: la funzione resta SECURITY DEFINER come nella 040 (legge i profili e gli
-- ordini di tutti), con search_path fisso; l'esecuzione resta solo a service_role, come
-- nelle migrazioni 059/064/425. Nessun permesso nuovo.

CREATE OR REPLACE FUNCTION public.process_expired_deletions()
RETURNS TABLE(user_id uuid, deleted_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cutoff timestamptz := now() - interval '7 days';
BEGIN
    RETURN QUERY
        SELECT p.id, p.deletion_requested_at
        FROM public.profiles p
        WHERE p.deletion_requested_at IS NOT NULL
          AND p.deletion_requested_at < cutoff
          AND NOT EXISTS (
              SELECT 1
              FROM public.orders o
              WHERE o.seller_id = p.id
                AND (
                    -- un ordine aperto
                    (
                        coalesce(o.delivery_status, 'NEW') NOT IN ('DELIVERED', 'CANCELED')
                        AND (o.payment_method = 'cod' OR o.payment_status IN ('PAID', 'PARTIALLY_REFUNDED'))
                    )
                    -- soldi del negozio ancora da incassare
                    OR o.payout_status IN ('HELD', 'PENDING_SELLER_ONBOARDING', 'PROCESSING', 'FAILED', 'AWAITING_REMITTANCE')
                )
          );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_expired_deletions() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_deletions() TO service_role;

NOTIFY pgrst, 'reload schema';
