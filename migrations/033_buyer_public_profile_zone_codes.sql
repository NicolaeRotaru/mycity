-- 033: buyer public profile opt-in + codici zona/quartiere
-- Idempotente.

-- =============================================================================
-- BUYER PUBLIC PROFILE
-- =============================================================================
-- Estende profiles con campi opt-in per profilo pubblico buyer.
-- Privacy by default: niente è pubblico se l'utente non attiva opt-in.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS public_profile_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS public_handle text,
    ADD COLUMN IF NOT EXISTS public_bio text,
    ADD COLUMN IF NOT EXISTS public_avatar_url text;

-- Unique constraint sull'handle (case-insensitive)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'profiles_public_handle_uidx'
    ) THEN
        CREATE UNIQUE INDEX profiles_public_handle_uidx
            ON public.profiles(LOWER(public_handle))
            WHERE public_handle IS NOT NULL;
    END IF;
END$$;

-- Estendi RLS: chiunque può leggere i campi pubblici quando opt-in attivo
DROP POLICY IF EXISTS "Public profile read" ON public.profiles;
CREATE POLICY "Public profile read" ON public.profiles
    FOR SELECT USING (public_profile_enabled = true OR auth.uid() = id);

-- =============================================================================
-- ZONE CODES (codici quartiere/CAP con sconto)
-- =============================================================================
-- Es. "BORGOFAX10" = 10% sconto a chi consegna in Borgo Faxhall
-- Acquisition + Behavioral Scientist: tribalismo + local identity

CREATE TABLE IF NOT EXISTS public.zone_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    zone_name text NOT NULL,
    zip text NOT NULL,
    city text NOT NULL DEFAULT 'Piacenza',
    discount_percent int NOT NULL CHECK (discount_percent BETWEEN 5 AND 50),
    min_order_cents int NOT NULL DEFAULT 1000,
    max_uses_per_user int NOT NULL DEFAULT 1,
    expires_at timestamptz,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','expired')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zone_codes_zip_status_idx ON public.zone_codes(zip, status)
    WHERE status = 'active';

ALTER TABLE public.zone_codes ENABLE ROW LEVEL SECURITY;

-- Pubblicamente leggibile (per mostrare 'sconto disponibile' a chi è in zona)
DROP POLICY IF EXISTS zone_codes_public_read ON public.zone_codes;
CREATE POLICY zone_codes_public_read ON public.zone_codes
    FOR SELECT USING (status = 'active');

-- Solo admin scrive
DROP POLICY IF EXISTS zone_codes_admin_write ON public.zone_codes;
CREATE POLICY zone_codes_admin_write ON public.zone_codes
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- Seed: codici di esempio per Piacenza
INSERT INTO public.zone_codes (code, zone_name, zip, discount_percent, min_order_cents) VALUES
    ('CENTRO10',    'Centro Storico',   '29121', 10, 1500),
    ('BORGOFAX15',  'Borgo Faxhall',    '29122', 15, 2000),
    ('SANTANTONIO10','Sant''Antonio',    '29122', 10, 1500),
    ('FARNESIANA10','Farnesiana',       '29122', 10, 1500),
    ('VELOCISTA15', 'Veloce 30 min',    '29100', 15, 3000)
ON CONFLICT (code) DO NOTHING;

-- Tracking utilizzo
CREATE TABLE IF NOT EXISTS public.zone_code_uses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL REFERENCES public.zone_codes(code) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    order_id uuid,
    used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zone_code_uses_user_idx ON public.zone_code_uses(user_id, code);

ALTER TABLE public.zone_code_uses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zone_code_uses_own_read ON public.zone_code_uses;
CREATE POLICY zone_code_uses_own_read ON public.zone_code_uses FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- LAZY ONBOARDING EMAIL queue
-- =============================================================================
-- Tabella job per email lifecycle automatiche. Ogni signup crea righe
-- "da inviare" con send_at futuro. Un cron esterno legge questa coda.

CREATE TABLE IF NOT EXISTS public.email_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    template text NOT NULL,
    send_at timestamptz NOT NULL,
    sent_at timestamptz,
    cancelled_at timestamptz,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_queue_pending_idx ON public.email_queue(send_at)
    WHERE sent_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
-- Solo admin/service-role gestisce (no policy = default deny per authenticated)

-- Trigger che enqueue 5 email lifecycle al signup
CREATE OR REPLACE FUNCTION public.enqueue_lifecycle_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.role <> 'buyer' AND NEW.role IS NOT NULL THEN
        RETURN NEW;
    END IF;
    -- Welcome (subito, già coperto da Resend trigger se esiste, ma lo mettiamo
    -- in queue per uniformità)
    INSERT INTO public.email_queue (user_id, template, send_at)
    VALUES
        (NEW.id, 'welcome',          now()),
        (NEW.id, 'tutorial_day2',    now() + interval '2 days'),
        (NEW.id, 'first_order_promo',now() + interval '5 days'),
        (NEW.id, 'reengagement_14d', now() + interval '14 days'),
        (NEW.id, 'winback_60d',      now() + interval '60 days')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_lifecycle ON public.profiles;
CREATE TRIGGER trg_enqueue_lifecycle
    AFTER INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_lifecycle_emails();

-- Quando un buyer fa il primo ordine, cancella le email "first_order_promo"
-- e "reengagement_14d" (sono già attivati)
CREATE OR REPLACE FUNCTION public.cancel_lifecycle_on_first_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_count FROM public.orders WHERE user_id = NEW.user_id;
    IF v_count = 1 THEN
        -- È il primo ordine: cancella reminder
        UPDATE public.email_queue
            SET cancelled_at = now()
        WHERE user_id = NEW.user_id
          AND template IN ('first_order_promo', 'reengagement_14d')
          AND sent_at IS NULL
          AND cancelled_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_lifecycle_first_order ON public.orders;
CREATE TRIGGER trg_cancel_lifecycle_first_order
    AFTER INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.cancel_lifecycle_on_first_order();

NOTIFY pgrst, 'reload schema';
