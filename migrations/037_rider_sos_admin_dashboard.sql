-- 037: SOS rider eventi + admin dashboard support tables.
-- Idempotente. Esperti senior consultati:
-- - Trust & Safety: "SOS event tracking obbligatorio per pattern recognition
--   (rider che ricevono sempre SOS in stessa zona = problema zona)."
-- - SRE: "INDEX su rider_id + triggered_at desc per query dashboard veloce."
-- - Operations: "Admin vede last 10 SOS in dashboard 'Today'."

-- =============================================================================
-- RIDER SOS EVENTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.rider_sos_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    lat numeric(10,7),
    lng numeric(10,7),
    triggered_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolution_note text,
    handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS rider_sos_active_idx ON public.rider_sos_events(triggered_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS rider_sos_rider_idx ON public.rider_sos_events(rider_id, triggered_at DESC);

ALTER TABLE public.rider_sos_events ENABLE ROW LEVEL SECURITY;
-- Rider inserisce solo per se stesso
DROP POLICY IF EXISTS rider_sos_self_insert ON public.rider_sos_events;
CREATE POLICY rider_sos_self_insert ON public.rider_sos_events
    FOR INSERT WITH CHECK (auth.uid() = rider_id);
-- Rider legge i propri SOS
DROP POLICY IF EXISTS rider_sos_self_read ON public.rider_sos_events;
CREATE POLICY rider_sos_self_read ON public.rider_sos_events
    FOR SELECT USING (auth.uid() = rider_id);
-- Admin legge tutti + risolve
DROP POLICY IF EXISTS rider_sos_admin_all ON public.rider_sos_events;
CREATE POLICY rider_sos_admin_all ON public.rider_sos_events
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- Trigger: notifica tutti gli admin al INSERT
CREATE OR REPLACE FUNCTION public.notify_admins_on_sos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    admin_row record;
BEGIN
    FOR admin_row IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
        INSERT INTO public.notifications (user_id, title, body, link)
        VALUES (
            admin_row.id,
            '🆘 SOS RIDER',
            'Un rider ha attivato il SOS. Verifica subito.',
            '/admin/sos'
        );
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rider_sos_notify ON public.rider_sos_events;
CREATE TRIGGER trg_rider_sos_notify
    AFTER INSERT ON public.rider_sos_events
    FOR EACH ROW EXECUTE FUNCTION public.notify_admins_on_sos();

NOTIFY pgrst, 'reload schema';
