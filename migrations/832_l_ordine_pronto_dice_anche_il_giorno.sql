-- =============================================================================
-- 832 — LA CAMPANELLA «ORDINE PRONTO» DICE ANCHE IL GIORNO DELLA FASCIA
-- =============================================================================
-- IL DIFETTO. Con una fascia scelta in cassa la campanella (321) diceva solo l'orario: un ordine
-- pronto stasera per «Domani · 9:00–12:00» leggeva «… te lo porta a casa nella fascia che hai
-- scelto (9:00–12:00).», senza «domani», e la cliente poteva aspettarlo stamattina. La 321 aveva
-- tolto «Oggi» e «Domani» perché sono veri il giorno dell'ordine, non per forza quello in cui è
-- pronto: qui il giorno si conta, invece di copiarlo.
--
-- LA CURA. Il giorno vero della fascia si conta dalla data dell'ordine a Piacenza (created_at nel
-- fuso Europe/Rome), come fanno la pagina e le email (lib/ordini/fascia-leggibile.ts): «Domani · …»
-- è il giorno dopo la nascita dell'ordine, «Oggi · …», «In giornata · …» e «Stasera · …» quello
-- stesso. Poi si confronta col giorno di adesso a Piacenza:
--   · la fascia è oggi    → «… te lo porta a casa oggi nella fascia che hai scelto (11:00–13:00).»
--   · la fascia è domani  → «… te lo porta a casa domani nella fascia che hai scelto (9:00–12:00).»
--   · la fascia è già passata, o l'etichetta non è una delle note → la frase di prima, senza giorno:
--     meglio nessun giorno che un giorno falso.
-- La consegna veloce e l'ordine senza fascia restano «a breve»; il ritiro in negozio non cambia.
--
-- NELLA STESSA FUNZIONE, chiesto dalla regia: la campanella «ordine pronto» non dice più «rider»
-- ma «fattorino», come la pagina dell'ordine e l'email («un fattorino passa a prenderlo»), in tutti
-- e due i rami a domicilio. Il resto della funzione è identico alla 321 (l'ultima versione).
-- CREATE OR REPLACE tiene i permessi (EXECUTE tolto a tutti in migrations/106) e il trigger.
--
-- NON si applica a mano: lo decide Nicola, come ogni migrazione. Si può rieseguire.
-- REVERSIBILE: rieseguire la funzione della 321.
-- LA PROVA: tests/sql/rls/riparazione-r02-ordine-pronto-col-giorno.test.sql.
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
  giorno_della_fascia date;
  quando   text := '';
BEGIN
  IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    short_id := upper(substr(NEW.id::text, 1, 6));
    -- La fascia scritta dalla cassa: «Oggi · 11:00–13:00», «Domani · 9:00–12:00»; la veloce è
    -- «Adesso · arrivo in …».
    fascia := nullif(btrim(coalesce(NEW.delivery_slot, '')), '');
    IF fascia IS NOT NULL AND fascia LIKE 'Adesso%' THEN
      fascia := NULL;
    END IF;
    orario := CASE WHEN fascia IS NOT NULL AND position(' · ' IN fascia) > 0
                   THEN btrim(split_part(fascia, ' · ', 2)) ELSE '' END;
    -- «Oggi» e «Domani» sono veri il giorno dell'ordine: il giorno della fascia si conta dalla data
    -- dell'ordine a Piacenza, e si dice confrontato col giorno di adesso.
    IF fascia IS NOT NULL AND position(' · ' IN fascia) > 0 THEN
      giorno_della_fascia := (NEW.created_at AT TIME ZONE 'Europe/Rome')::date
        + CASE btrim(split_part(fascia, ' · ', 1))
            WHEN 'Domani'      THEN 1
            WHEN 'Oggi'        THEN 0
            WHEN 'In giornata' THEN 0
            WHEN 'Stasera'     THEN 0
          END;
      quando := CASE
                  WHEN giorno_della_fascia = (now() AT TIME ZONE 'Europe/Rome')::date     THEN ' oggi'
                  WHEN giorno_della_fascia = (now() AT TIME ZONE 'Europe/Rome')::date + 1 THEN ' domani'
                  ELSE ''
                END;
    END IF;
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
          -- Una fascia scelta in cassa: si dice quella, col suo giorno quando è oggi o domani,
          -- con le parole dell'email «ordine pronto» (lib/email/templates.ts), non «a breve».
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.user_id, 'Ordine pronto',
             'Il tuo ordine #' || short_id || ' è pronto: un fattorino passa a prenderlo e te lo porta a casa'
               || quando || ' nella fascia che hai scelto'
               || CASE WHEN orario <> '' THEN ' (' || orario || ')' ELSE '' END || '.',
             '/orders/' || NEW.id, 'order');
        ELSE
          -- La consegna veloce («Adesso · …») o un ordine senza fascia: «a breve» è vero.
          INSERT INTO public.notifications (user_id, title, body, link, category) VALUES
            (NEW.user_id, 'Ordine pronto',
             'Il tuo ordine #' || short_id || ' è pronto: un fattorino passa a prenderlo a breve e te lo porta a casa.',
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
