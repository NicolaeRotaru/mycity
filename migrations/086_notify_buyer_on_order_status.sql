-- 086_notify_buyer_on_order_status.sql
--
-- FIX (notifiche bloccate). Le notifiche in-app create dal CLIENT
-- (lib/notifications.ts usa il client browser/anon) verso un ALTRO utente
-- venivano negate dalla RLS di `notifications` (nessuna policy INSERT) e
-- fallivano in silenzio. Risultato: il BUYER non era avvisato su
-- ACCEPTED/READY/ASSIGNED/OUT_FOR_DELIVERY e il SELLER non su ASSIGNED; di
-- conseguenza nemmeno la push (che legge da `notifications`) partiva.
--
-- Soluzione: un trigger SECURITY DEFINER (bypassa la RLS) che crea le notifiche
-- mancanti SERVER-SIDE ad ogni cambio di delivery_status. Best-effort
-- (EXCEPTION-swallow): una notifica non deve mai far fallire l'avanzamento ordine.
--
-- NON duplica i trigger esistenti: 019 notifica i RIDER su ACCEPTED/READY; le RPC
-- verify_pickup_code/verify_delivery_code notificano buyer+seller su
-- PICKED_UP/DELIVERED; cancel_order/seller_reject_order gestiscono gli annulli.
-- Qui si coprono solo i buchi lato buyer/seller. Idempotente.

CREATE OR REPLACE FUNCTION public.notify_buyer_on_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE short_id text;
BEGIN
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    short_id := upper(substr(NEW.id::text, 1, 6));
    BEGIN
      IF NEW.delivery_status = 'ACCEPTED' THEN
        INSERT INTO public.notifications (user_id, title, body, link) VALUES
          (NEW.user_id, '✅ Ordine accettato',
           'Il negozio ha accettato il tuo ordine #' || short_id || ' e lo sta preparando.',
           '/orders/' || NEW.id);
      ELSIF NEW.delivery_status = 'READY' THEN
        INSERT INTO public.notifications (user_id, title, body, link) VALUES
          (NEW.user_id, '📦 Ordine pronto',
           'Il tuo ordine #' || short_id || ' è pronto: un rider lo ritirerà a breve.',
           '/orders/' || NEW.id);
      ELSIF NEW.delivery_status = 'ASSIGNED' THEN
        INSERT INTO public.notifications (user_id, title, body, link) VALUES
          (NEW.user_id, '🛵 Un rider ha preso il tuo ordine',
           'Il rider ritirerà l''ordine #' || short_id || ' e te lo porterà.',
           '/orders/' || NEW.id);
        IF NEW.seller_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, body, link) VALUES
            (NEW.seller_id, '🛵 Rider assegnato',
             'Un rider ritirerà l''ordine #' || short_id || '.',
             '/seller/orders/' || NEW.id);
        END IF;
      ELSIF NEW.delivery_status = 'OUT_FOR_DELIVERY' THEN
        INSERT INTO public.notifications (user_id, title, body, link) VALUES
          (NEW.user_id, '🚚 Ordine in consegna',
           'Il tuo ordine #' || short_id || ' è in arrivo!',
           '/orders/' || NEW.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- best-effort: la notifica non deve bloccare la transizione di stato
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_buyer_on_order_status ON public.orders;
CREATE TRIGGER trg_notify_buyer_on_order_status
  AFTER UPDATE OF delivery_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_buyer_on_order_status();

NOTIFY pgrst, 'reload schema';
