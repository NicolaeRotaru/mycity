-- =============================================================================
-- 055 — Tracking invio push (Step 5)
-- =============================================================================
-- Il cron /api/cron/send-push invia una web push per le notifiche non ancora
-- inviate. pushed_at = timestamp del tentativo (NULL = da inviare). Additivo.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- Indice parziale per il claim del cron (solo le righe da processare).
CREATE INDEX IF NOT EXISTS idx_notifications_pending_push
  ON public.notifications (created_at)
  WHERE pushed_at IS NULL;

NOTIFY pgrst, 'reload schema';
