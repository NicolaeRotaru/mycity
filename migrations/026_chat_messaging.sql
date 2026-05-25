-- 026: chat buyer ↔ seller con Realtime.
-- Una sola conversazione per coppia (buyer_id, seller_id). Niente "thread per
-- prodotto" in MVP: tiene il modello semplice e l'UX a 1 inbox per coppia.
-- I trigger aggiornano counter unread e preview ultimo messaggio per evitare
-- di fare aggregazioni lato client.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    last_message_at timestamptz NOT NULL DEFAULT now(),
    last_message_preview text,
    buyer_unread_count int NOT NULL DEFAULT 0,
    seller_unread_count int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT conversations_buyer_seller_unique UNIQUE (buyer_id, seller_id),
    CONSTRAINT conversations_not_self CHECK (buyer_id <> seller_id)
);

CREATE INDEX IF NOT EXISTS conversations_buyer_idx
    ON public.conversations (buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_seller_idx
    ON public.conversations (seller_id, last_message_at DESC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_select_own ON public.conversations;
CREATE POLICY conversations_select_own ON public.conversations
    FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- Solo il buyer può creare una conversazione (il seller non può forzare DM).
DROP POLICY IF EXISTS conversations_insert_buyer ON public.conversations;
CREATE POLICY conversations_insert_buyer ON public.conversations
    FOR INSERT WITH CHECK (auth.uid() = buyer_id);

-- Update permesso a entrambi (per reset counter unread lato proprio).
DROP POLICY IF EXISTS conversations_update_participants ON public.conversations;
CREATE POLICY conversations_update_participants ON public.conversations
    FOR UPDATE USING (auth.uid() = buyer_id OR auth.uid() = seller_id);


CREATE TABLE IF NOT EXISTS public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
    ON public.messages (conversation_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_select_participants ON public.messages;
CREATE POLICY messages_select_participants ON public.messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
        )
    );

-- Inserimento: solo i partecipanti, e solo come sender se sender_id == auth.uid().
DROP POLICY IF EXISTS messages_insert_self ON public.messages;
CREATE POLICY messages_insert_self ON public.messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
              AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
        )
    );

-- Update permesso ai partecipanti per marcare read_at (mai modificare body).
DROP POLICY IF EXISTS messages_update_read ON public.messages;
CREATE POLICY messages_update_read ON public.messages
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
        )
    );


-- Trigger: dopo un INSERT su messages, aggiorna preview, last_message_at
-- e counter unread sull'altra parte.
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer uuid;
    v_seller uuid;
BEGIN
    SELECT buyer_id, seller_id INTO v_buyer, v_seller
    FROM public.conversations WHERE id = NEW.conversation_id;

    UPDATE public.conversations SET
        last_message_at = NEW.created_at,
        last_message_preview = substring(NEW.body, 1, 200),
        buyer_unread_count = CASE
            WHEN NEW.sender_id = v_seller THEN buyer_unread_count + 1
            ELSE buyer_unread_count
        END,
        seller_unread_count = CASE
            WHEN NEW.sender_id = v_buyer THEN seller_unread_count + 1
            ELSE seller_unread_count
        END
    WHERE id = NEW.conversation_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_conv_on_msg ON public.messages;
CREATE TRIGGER trg_update_conv_on_msg
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_message();


-- Abilita Realtime per UI live: il client si iscrive ai canali postgres_changes
-- filtrati per conversation_id. RLS si applica anche sui broadcast Realtime.
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

NOTIFY pgrst, 'reload schema';
