-- =============================================================================
-- 411 — Il cliente dice di aver rispedito la merce, e il recesso non si chiude più senza rimborso (R17-003)
-- =============================================================================
-- IL DIFETTO. Un recesso (motivo CHANGED_MIND) approvato si poteva chiudere
-- «senza rimborso» dal negozio quando erano passati 14 giorni e il reso era
-- ancora APPROVED: la regola presumeva che il cliente non avesse rispedito
-- niente. Ma «in rientro» (SHIPPED_BACK) e «ricevuto» (RECEIVED) li scriveva solo
-- il negozio, cioè chi ha interesse a non rimborsare: il cliente non aveva modo
-- di dire «ho spedito il pacco». Recesso approvato il 2/11, pacco spedito il
-- 15/11 (nei 14 giorni), il 17/11 il negozio non ha ancora il pacco, preme
-- «Chiudi senza rimborso», il bonifico al negozio riparte e il reso chiuso non
-- si riapre. Cod. Cons. art. 56 c.3: il rimborso si trattiene solo finché non
-- arrivano i beni o la prova che il consumatore li ha rispediti.
--
-- LA CURA. La rotta `app/api/returns/[id]/avanza` lascia al cliente dell'ordine
-- il passo APPROVED → SHIPPED_BACK, con il giorno della spedizione e, se ce
-- l'ha, il numero di spedizione. Da SHIPPED_BACK un recesso non si chiude senza
-- rimborso (la regola c'è dal 31/10, lib/rimborsi/regole-del-rimborso.ts) e il
-- giro dei bonifici lo tiene fermo come reso aperto. Questa migrazione fa la
-- parte del database:
--
--   ① returns.customer_shipped_back_on (date): il giorno in cui il CLIENTE dice
--      di aver rispedito la merce. Il numero di spedizione va nella colonna che
--      c'è già dalla 024, tracking_number. Scrive solo il server: INSERT, UPDATE
--      e DELETE sui resi sono tolti ai clienti dalla 153 e qui non si ridanno.
--      La lettura resta quella di sempre (returns_buyer_read, returns_seller_read).
--
--   ② un guardiano della riga, che vale per chiunque scriva, chiave di servizio
--      compresa (come quello della 153):
--      · la dichiarazione del cliente si scrive solo nel passo APPROVED →
--        SHIPPED_BACK, e poi non si cambia e non si cancella;
--      · un recesso con la merce in viaggio o in negozio (SHIPPED_BACK,
--        RECEIVED) non diventa CANCELED né REJECTED. È la regola che la rotta
--        applica già (percheIlRecessoNonSiChiude), scritta anche qui: il giorno
--        in cui una rotta nuova la dimentica, la riga non cambia.
--
-- Riapplicabile: la colonna «se non c'è», la funzione «or replace», il trigger
-- tolto e rimesso. Non applicata: la applica Nicola. Prima che sia applicata la
-- rotta scrive la dichiarazione senza il giorno (stato e numero di spedizione
-- restano), e il giorno arriva al negozio nell'avviso.
--
-- REVERSIBILE:
--   DROP TRIGGER IF EXISTS trg_returns_la_spedizione_la_dichiara_il_cliente ON public.returns;
--   DROP FUNCTION IF EXISTS public.returns_la_spedizione_la_dichiara_il_cliente();
--   ALTER TABLE public.returns DROP COLUMN IF EXISTS customer_shipped_back_on;
--
-- La prova: tests/sql/rls/riparazione-r17-recesso-merce-spedita.test.sql.
-- =============================================================================

BEGIN;

-- ① Il giorno della spedizione dichiarato dal cliente.
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS customer_shipped_back_on date;

COMMENT ON COLUMN public.returns.customer_shipped_back_on IS
  'Il giorno in cui il cliente dichiara di aver rispedito la merce (R17-003). Lo scrive solo il server, '
  'per il cliente dell''ordine, nel passo APPROVED -> SHIPPED_BACK; poi non cambia. Il numero di spedizione '
  'sta in tracking_number.';

-- ② Il guardiano della riga.
CREATE OR REPLACE FUNCTION public.returns_la_spedizione_la_dichiara_il_cliente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_shipped_back_on IS NOT NULL THEN
      RAISE EXCEPTION 'Un reso nasce senza spedizione dichiarata: il cliente la dichiara dopo l approvazione.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- La dichiarazione del cliente si scrive una volta, nel passo giusto, e resta.
  IF OLD.customer_shipped_back_on IS NOT NULL
     AND NEW.customer_shipped_back_on IS DISTINCT FROM OLD.customer_shipped_back_on THEN
    RAISE EXCEPTION 'Il giorno della spedizione dichiarato dal cliente non si cambia e non si cancella.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.customer_shipped_back_on IS NULL
     AND NEW.customer_shipped_back_on IS NOT NULL
     AND NOT (OLD.status = 'APPROVED' AND NEW.status = 'SHIPPED_BACK') THEN
    RAISE EXCEPTION 'La spedizione del cliente si dichiara solo passando da APPROVED a SHIPPED_BACK, non da % a %.',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Il recesso con la merce partita o arrivata si chiude solo col rimborso.
  IF (OLD.reason = 'CHANGED_MIND' OR NEW.reason = 'CHANGED_MIND')
     AND OLD.status IN ('SHIPPED_BACK', 'RECEIVED')
     AND NEW.status IN ('CANCELED', 'REJECTED') THEN
    RAISE EXCEPTION 'Un recesso con la merce in viaggio o in negozio non si chiude senza rimborso (Cod. Cons. artt. 56-57).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.returns_la_spedizione_la_dichiara_il_cliente() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_returns_la_spedizione_la_dichiara_il_cliente ON public.returns;
CREATE TRIGGER trg_returns_la_spedizione_la_dichiara_il_cliente
  BEFORE INSERT OR UPDATE ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public.returns_la_spedizione_la_dichiara_il_cliente();

COMMIT;

NOTIFY pgrst, 'reload schema';
