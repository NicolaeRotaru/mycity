-- 028: tabella contact_messages per gestire i messaggi del form contatti.
-- L'utente compila il form pubblico (anche non loggato): mail diretta a
-- support@ + riga in DB per tracking + risposta. Admin vede lista e marca
-- come risolto.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.contact_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
    email text NOT NULL,
    subject text NOT NULL DEFAULT 'Domanda generale',
    message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 5000),
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved','spam')),
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    admin_notes text,
    handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    handled_at timestamptz,
    ip text,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_messages
    ADD CONSTRAINT contact_messages_email_format
    CHECK (email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$');

CREATE INDEX IF NOT EXISTS contact_status_created_idx
    ON public.contact_messages(status, created_at DESC);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- INSERT pubblico (anche guest) — controllato dal rate limit nel route handler.
DROP POLICY IF EXISTS contact_insert_public ON public.contact_messages;
CREATE POLICY contact_insert_public ON public.contact_messages
    FOR INSERT WITH CHECK (true);

-- Admin read/update
DROP POLICY IF EXISTS contact_admin_read ON public.contact_messages;
CREATE POLICY contact_admin_read ON public.contact_messages
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

DROP POLICY IF EXISTS contact_admin_update ON public.contact_messages;
CREATE POLICY contact_admin_update ON public.contact_messages
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

NOTIFY pgrst, 'reload schema';
