-- =============================================================================
-- 840 — Due veloci vendute nello stesso istante non passano con un fattorino solo
-- =============================================================================
-- La rotta dei contanti (app/api/orders/cod/route.ts) decide se la veloce si può
-- con `veloceSiPuo`: conta i fattorini accesi che non hanno già una veloce in
-- mano (`contaFattoriniOnline`, lib/ordini/consegna-veloce.ts) e poi inserisce
-- l'ordine. Fra la lettura e l'inserimento non c'era nessun lucchetto: due
-- clienti che premono «Adesso» nello stesso istante, con un fattorino solo,
-- leggevano tutti e due «un fattorino libero» e nascevano due veloci. Una delle
-- due promesse «30-60 minuti» non si poteva mantenere.
--
-- La regola è quella che il codice già applica (scelta di Nicola del 19/11, fatto
-- `consegna.veloce-per-fattorino`: un fattorino porta una veloce alla volta), detta
-- qui una seconda volta nel posto dove due richieste si mettono in fila:
--   · fattorini accesi = ruolo rider, approvati, interruttore acceso;
--   · consegne veloci in corso = ordini con la fascia della veloce, in uno stato
--     fra il nuovo e il «in strada», nati nelle ultime 3 ore (ORE_PER_ACCETTARE),
--     contati per cliente (un carrello di due negozi è una consegna sola);
--   · una veloce nuova nasce solo se le consegne in corso più la sua non superano
--     i fattorini accesi. Se il cliente ha già una veloce in corso (il secondo
--     negozio dello stesso carrello) è la stessa porta, e passa.
-- Se una di queste regole cambia nel codice, va cambiata anche qui.
--
-- Il lucchetto (pg_advisory_xact_lock, fino alla fine della transazione) mette in
-- fila le veloci in contanti: la seconda aspetta che la prima sia scritta, la vede
-- e si ferma con 23514 e il segno `veloce_senza_fattorino_libero`, che la rotta
-- trasforma nel 409 «non c'è un fattorino libero».
--
-- Cosa NON cambia:
--   · gli ordini che non sono veloci (fasce, ritiro in negozio): il controllo esce
--     subito, come prima;
--   · le veloci pagate con la carta: nascono nel webhook DOPO il pagamento, e un
--     rifiuto lì lascerebbe un cliente che ha pagato senza ordine. Contano fra le
--     consegne in corso, ma non vengono mai fermate qui;
--   · le righe che ci sono già: si guarda solo l'ordine che nasce.
--
-- Prova: tests/sql/rls/riparazione-r03-veloce.test.sql
-- Per tornare indietro:
--   DROP TRIGGER IF EXISTS orders_veloce_solo_con_un_fattorino_libero ON public.orders;
--   DROP FUNCTION IF EXISTS public.orders_veloce_solo_con_un_fattorino_libero();
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.orders_veloce_solo_con_un_fattorino_libero()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  accesi   integer;
  consegne integer;
BEGIN
  -- Solo la veloce in contanti a domicilio, appena venduta. Tutto il resto passa come prima.
  -- La fascia è ETICHETTA_ADESSO di lib/quando-arriva.ts («Adesso · arrivo in 30-60 min»).
  IF NEW.payment_method IS DISTINCT FROM 'cod'
     OR NEW.delivery_slot IS DISTINCT FROM 'Adesso · arrivo in 30-60 min'
     OR coalesce(NEW.pickup_in_store, false)
     OR coalesce(NEW.delivery_status, 'NEW') NOT IN ('NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY') THEN
    RETURN NEW;
  END IF;

  -- Le veloci in contanti in fila una alla volta: chi arriva dopo vede chi è già nato.
  PERFORM pg_advisory_xact_lock(hashtextextended('orders:veloce-in-contanti', 0));

  -- Il secondo negozio dello stesso carrello (o un altro carrello dello stesso cliente):
  -- va alla stessa porta, non chiede un altro fattorino.
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.user_id = NEW.user_id
       AND o.delivery_slot = NEW.delivery_slot
       AND o.delivery_status IN ('NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY')
       AND (o.created_at IS NULL OR o.created_at >= now() - interval '3 hours')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO accesi
    FROM public.profiles p
   WHERE p.role = 'rider' AND p.is_approved = true AND p.rider_is_online = true;

  SELECT count(DISTINCT coalesce('cliente:' || o.user_id::text, 'riga:' || o.id::text)) INTO consegne
    FROM public.orders o
   WHERE o.delivery_slot = NEW.delivery_slot
     AND o.delivery_status IN ('NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY')
     AND (o.created_at IS NULL OR o.created_at >= now() - interval '3 hours');

  -- Una veloce alla volta per fattorino (VELOCI_PER_FATTORINO = 1).
  IF consegne + 1 > accesi THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Adesso non c''è un fattorino libero per la consegna veloce. Scegli una fascia oraria: la consegna arriva quando la scegli tu.',
      HINT = 'veloce_senza_fattorino_libero';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_veloce_solo_con_un_fattorino_libero() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_veloce_solo_con_un_fattorino_libero ON public.orders;
CREATE TRIGGER orders_veloce_solo_con_un_fattorino_libero
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_veloce_solo_con_un_fattorino_libero();

COMMIT;
