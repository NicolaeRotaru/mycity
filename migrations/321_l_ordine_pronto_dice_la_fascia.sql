-- =============================================================================
-- 321 — LA CAMPANELLA «ORDINE PRONTO» DICE LA FASCIA, NON «A BREVE» (R08-016)
-- =============================================================================
-- Quando il negozio segna l'ordine come pronto, il trigger scriveva sempre «un
-- rider passa a prenderlo a breve e te lo porta a casa». Non guardava
-- `delivery_slot`. L'email e la pagina dell'ordine erano già passate a «nella
-- fascia che hai scelto»; la campanella no, e nemmeno la notifica push che nasce
-- da quella riga. Visto in palestra: pronto alle 02:25 per la fascia 11:00–13:00,
-- e la cliente leggeva «a breve».
--
-- Qui si riscrive solo il ramo READY a domicilio della funzione (ultima versione:
-- migrations/215). Con una fascia scelta: «… te lo porta a casa nella fascia che
-- hai scelto (11:00–13:00).». Con la consegna veloce o senza fascia resta la frase
-- di prima. Tutto il resto della funzione è identico alla 215. CREATE OR REPLACE
-- tiene i permessi (EXECUTE tolto a tutti in migrations/106) e il trigger.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_buyer_on_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  short_id text;
  fascia   text;
  orario   text;
BEGIN
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    short_id := upper(substr(NEW.id::text, 1, 6));
    -- La fascia scritta dalla cassa: «Oggi · 11:00–13:00», «Domani · 9:00–12:00»; la veloce è
    -- «Adesso · arrivo in …». Nella campanella va solo l'orario: «Oggi» e «Domani» sono veri il
    -- giorno dell'ordine, non per forza il giorno in cui è pronto.
    fascia := nullif(btrim(coalesce(NEW.delivery_slot, '')), '');
    IF fascia IS NOT NULL AND fascia LIKE 'Adesso%' THEN
      fascia := NULL;
    END IF;
    orario := CASE WHEN fascia IS NOT NULL AND position(' · ' IN fascia) > 0
                   THEN btrim(split_part(fascia, ' · ', 2)) ELSE '' END;
    BEGIN
      IF NEW.delivery_status = 'ACCEPTED' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, 'Ordine accettato',
           'Il negozio ha accettato il tuo ordine #' || short_id || ' e lo sta preparando.',
           '/orders/' || NEW.id, 'order');
      ELSIF NEW.delivery_status = 'READY' AND OLD.delivery_status IS DISTINCT FROM 'ASSIGNED' THEN
        -- Un ordine che torna in READY perché il rider l'ha lasciato non è una
        -- notizia nuova per il cliente: l'ha già saputo.
        IF coalesce(NEW.pickup_in_store, false) THEN
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.user_id, 'Ordine pronto',
             'Il tuo ordine #' || short_id || ' è pronto: puoi passare a ritirarlo in negozio.',
             '/orders/' || NEW.id, 'order');
        ELSIF fascia IS NOT NULL THEN
          -- R08-016 — una fascia scelta in cassa: si dice quella, con le parole
          -- dell'email «ordine pronto» (lib/email/templates.ts), non «a breve».
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.user_id, 'Ordine pronto',
             'Il tuo ordine #' || short_id || ' è pronto: un rider passa a prenderlo e te lo porta a casa nella fascia che hai scelto'
               || CASE WHEN orario <> '' THEN ' (' || orario || ')' ELSE '' END || '.',
             '/orders/' || NEW.id, 'order');
        ELSE
          -- La consegna veloce («Adesso · …») o un ordine senza fascia: «a breve» è vero.
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.user_id, 'Ordine pronto',
             'Il tuo ordine #' || short_id || ' è pronto: un rider passa a prenderlo a breve e te lo porta a casa.',
             '/orders/' || NEW.id, 'order');
        END IF;
      ELSIF NEW.delivery_status = 'ASSIGNED' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, 'Un rider ha preso il tuo ordine',
           'Il rider passa a prendere l''ordine #' || short_id || ' e te lo porta.',
           '/orders/' || NEW.id, 'order');
        IF NEW.seller_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.seller_id, 'Rider assegnato',
             'Un rider passa a prendere l''ordine #' || short_id || '.',
             '/seller/orders/' || NEW.id, 'order');
        END IF;
      ELSIF NEW.delivery_status = 'OUT_FOR_DELIVERY' THEN
        INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
          (NEW.user_id, 'Ordine in consegna',
           'Il tuo ordine #' || short_id || ' è in arrivo!',
           '/orders/' || NEW.id, 'order');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- best-effort: la notifica non blocca la transizione di stato, ma lascia traccia.
      RAISE WARNING 'notify_buyer_on_order_status: avviso non scritto per % (%): %',
        NEW.id, NEW.delivery_status, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

