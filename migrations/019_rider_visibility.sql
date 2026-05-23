-- 019: rider vede anche gli ordini in preparazione + notifiche automatiche
--
-- 1) Allarga la policy SELECT del rider per vedere anche ACCEPTED (in
--    preparazione) oltre a READY (pronti per pickup)
-- 2) Trigger: alla transizione → ACCEPTED notifica tutti i rider attivi
-- 3) Trigger: alla transizione → READY notifica tutti i rider con
--    messaggio piu' urgente (ora possono prenderlo)
--
-- Idempotente.

-- ============================================
-- 1) RLS: rider vede ACCEPTED + READY senza rider, e i propri ordini
-- ============================================
DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;
CREATE POLICY "Riders can view available and own orders"
  ON public.orders FOR SELECT
  USING (
    (delivery_status IN ('ACCEPTED', 'READY') AND rider_id IS NULL)
    OR rider_id = auth.uid()
  );

-- ============================================
-- 2) Trigger: notifica rider quando seller ACCETTA
-- ============================================
CREATE OR REPLACE FUNCTION public.notify_riders_on_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_status = 'ACCEPTED'
     AND (OLD.delivery_status IS DISTINCT FROM 'ACCEPTED') THEN
    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT p.id,
           '📦 Ordine in preparazione',
           'Il negozio sta preparando un ordine. A breve sara'' disponibile per il ritiro.',
           '/rider'
    FROM public.profiles p
    WHERE p.role = 'rider' AND p.is_approved = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_riders_on_accepted ON public.orders;
CREATE TRIGGER trigger_notify_riders_on_accepted
  AFTER UPDATE OF delivery_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_riders_on_accepted();

-- ============================================
-- 3) Trigger: notifica rider quando ordine diventa READY
-- ============================================
CREATE OR REPLACE FUNCTION public.notify_riders_on_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.delivery_status = 'READY'
     AND (OLD.delivery_status IS DISTINCT FROM 'READY') THEN
    INSERT INTO public.notifications (user_id, title, body, link)
    SELECT p.id,
           '🚀 Ordine pronto per il ritiro!',
           'Un ordine e'' disponibile. Prendilo prima degli altri rider.',
           '/rider'
    FROM public.profiles p
    WHERE p.role = 'rider' AND p.is_approved = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_riders_on_ready ON public.orders;
CREATE TRIGGER trigger_notify_riders_on_ready
  AFTER UPDATE OF delivery_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_riders_on_ready();

NOTIFY pgrst, 'reload schema';
