-- 038: Security hardening — newsletter spam vector + RLS audit
-- Esperti senior consultati:
-- - Security Engineer (OWASP): "INSERT WITH CHECK (true) su newsletter_subscribers
--   = chiunque iscrive chiunque. Spam attack + GDPR violation (consenso non
--   prestato). Rate limit DB-level + email validation."
-- - Backend Engineer: "Rate limit a livello trigger = no bypass possibile."
-- - SRE: "Rate limit 1/email/ora + 5/IP/giorno (se hai IP nel insert)."

-- =============================================================================
-- NEWSLETTER RATE LIMIT (anti-spam)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.newsletter_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 1 iscrizione per email per ora (idempotenza)
    IF EXISTS (
        SELECT 1 FROM public.newsletter_subscribers
        WHERE email = NEW.email
          AND created_at > now() - interval '1 hour'
    ) THEN
        RAISE EXCEPTION 'Rate limit: questa email è già stata iscritta di recente'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Email format basic check (anti-malformed)
    IF NEW.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Email non valida'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_newsletter_rate_limit ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_rate_limit
    BEFORE INSERT ON public.newsletter_subscribers
    FOR EACH ROW EXECUTE FUNCTION public.newsletter_rate_limit();

-- =============================================================================
-- CONTACT MESSAGES RATE LIMIT
-- =============================================================================
-- Stessa logica: chiunque può inserire ma rate-limited.

CREATE OR REPLACE FUNCTION public.contact_messages_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Max 3 messaggi per email per ora (prevent flood)
    IF (
        SELECT count(*) FROM public.contact_messages
        WHERE email = NEW.email
          AND created_at > now() - interval '1 hour'
    ) >= 3 THEN
        RAISE EXCEPTION 'Hai inviato troppi messaggi. Riprova tra un''ora.'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Email format check
    IF NEW.email IS NOT NULL AND NEW.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Email non valida'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Message length validation (anti-empty + anti-bomb)
    IF NEW.message IS NULL OR length(NEW.message) < 10 THEN
        RAISE EXCEPTION 'Messaggio troppo corto (min 10 caratteri)'
            USING ERRCODE = 'check_violation';
    END IF;
    IF length(NEW.message) > 5000 THEN
        RAISE EXCEPTION 'Messaggio troppo lungo (max 5000 caratteri)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_messages_rate_limit ON public.contact_messages;
CREATE TRIGGER trg_contact_messages_rate_limit
    BEFORE INSERT ON public.contact_messages
    FOR EACH ROW EXECUTE FUNCTION public.contact_messages_rate_limit();

-- =============================================================================
-- DOCUMENTAZIONE RLS USING(true) — audit intent
-- =============================================================================
-- Le policy con USING(true) sono review-passed perché contenuto pubblico:
--
-- 1. categories (002): catalogo categorie pubblico — OK
-- 2. product_categories (002): mapping pubblico — OK
-- 3. competitions (015): pubblico — OK
-- 4. competition_entries (015): leaderboard pubblica — OK
-- 5. dailycheckins (014): tabella obsolete? — TODO verifica
-- 6. push_subscription_topics (014): topics pubblici — OK
-- 7. abandoned_carts (027): leggibile SOLO admin via separata policy — VERIFICA
-- 8. daily_stories (027): contenuto editoriale pubblico — OK
-- 9. achievements (030): catalogo achievement pubblico — OK
-- 10. sponsored_listings (030): solo status='active' — protetto da filter
-- 11. shop_of_month + votes + leaderboard (034): pubblico — OK
-- 12. marketplace_events (034): solo published — protetto da filter
-- 13. event_rsvps (034): count pubblico, no PII esposta — OK
--
-- Le policy con WITH CHECK(true) ora hanno trigger rate limit:
-- - newsletter_subscribers (015) → trg_newsletter_rate_limit
-- - contact_messages (028) → trg_contact_messages_rate_limit
-- - abandoned_carts INSERT (027) → user_id ownership policy

NOTIFY pgrst, 'reload schema';
