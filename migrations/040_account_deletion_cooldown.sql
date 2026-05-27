-- 040: Account deletion cooldown 7 giorni (GDPR best practice)
--
-- Esperti consultati:
-- - Privacy Officer: "GDPR Art.17 prevede cancellazione 'senza giustificato
--   ritardo' MA NON 'immediato'. 7 giorni di grace = best practice per evitare
--   cancellazioni accidentali + permette user di annullare se ripensa."
-- - Trust & Safety: "Account compromessi spesso vengono usati per cancellare
--   account legittimo. Cooldown = finestra per recovery."
-- - SRE: "Cron giornaliero processa i due punti: cancella scaduti, notifica
--   gli utenti 24h prima del cutoff."

-- =============================================================================
-- COLONNA DELETION_REQUESTED_AT
-- =============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

COMMENT ON COLUMN public.profiles.deletion_requested_at IS
'Timestamp richiesta cancellazione. NULL = nessuna richiesta. Cron rimuove account 7gg dopo questa data.';

-- Index per cron che cerca account scaduti
CREATE INDEX IF NOT EXISTS profiles_deletion_pending_idx
    ON public.profiles(deletion_requested_at)
    WHERE deletion_requested_at IS NOT NULL;

-- =============================================================================
-- POLICY: utente puo' settare/togliere proprio flag
-- =============================================================================

-- La policy esistente "profiles_owner_update" gia' permette UPDATE su own row.
-- Non serve nuova policy.

-- =============================================================================
-- FUNCTION: cancella account scaduti (chiamata da cron)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_expired_deletions()
RETURNS TABLE(user_id uuid, deleted_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cutoff timestamptz := now() - interval '7 days';
BEGIN
    -- Restituisce gli userId scaduti — il caller (cron endpoint) si occupa di
    -- chiamare admin.auth.deleteUser per ognuno (anonymize + auth delete).
    -- Non facciamo l'anonymize qui per separazione responsabilita': SQL
    -- non puo' chiamare auth.users delete senza extension specifiche.
    RETURN QUERY
        SELECT id, deletion_requested_at
        FROM public.profiles
        WHERE deletion_requested_at IS NOT NULL
          AND deletion_requested_at < cutoff;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_expired_deletions() TO service_role;

NOTIFY pgrst, 'reload schema';
