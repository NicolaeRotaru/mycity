-- =============================================================================
-- 429 — Due promo uguali non restano attive insieme (R18-012)
-- =============================================================================
-- Un doppio clic su «Crea promo» faceva due righe identiche in seller_promotions,
-- tutte e due attive: il negoziante ne cancellava una convinto di aver chiuso lo
-- sconto, e l'altra continuava a scontare fino alla scadenza. La tabella non aveva
-- nessun freno contro le righe uguali. La pagina adesso ha il suo freno
-- (app/seller/promotions/page.tsx); questo è quello del database, per un secondo
-- clic che arriva da un'altra scheda o da un altro telefono.
--
-- La regola: una promo attiva non nasce (e una annullata non si riaccende) se lo
-- stesso negozio ha già una promo attiva con lo stesso titolo, lo stesso sconto e
-- lo stesso bersaglio (scope, categoria, prodotti) e le due durate si
-- sovrappongono adesso o più avanti. Una promo scaduta o annullata non ferma
-- niente: la stessa promo si può rifare la settimana dopo, o subito dopo averla
-- annullata.
--
-- Perché un controllo e non un indice unico: la fine della promo la calcola il
-- telefono, e due clic la scrivono diversa di qualche millesimo; un indice su
-- (negozio, titolo, sconto, bersaglio) fermerebbe invece anche la promo rifatta
-- dopo la scadenza, perché le promo scadute restano «active» nel database.
-- I due inserimenti di un doppio clic arrivano in due transazioni insieme e
-- nessuna vede l'altra: il lucchetto per negozio (pg_advisory_xact_lock, fino
-- alla fine della transazione) li mette in fila, e il secondo vede il primo.
--
-- Le righe doppie che ci sono già NON si toccano e NON fermano la migrazione: il
-- controllo guarda solo le righe nuove (o riaccese). Per trovarle:
--   SELECT seller_id, title, discount_percent, scope, count(*)
--     FROM public.seller_promotions
--    WHERE status = 'active' AND ends_at > now()
--    GROUP BY 1, 2, 3, 4, category_id, product_ids HAVING count(*) > 1;
--
-- Prova: tests/sql/rls/riparazione-r18-promo-doppia.test.sql
-- Per tornare indietro:
--   DROP TRIGGER IF EXISTS seller_promotions_niente_doppioni ON public.seller_promotions;
--   DROP FUNCTION IF EXISTS public.seller_promotions_niente_doppioni();
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.seller_promotions_niente_doppioni()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Solo una promo che nasce attiva, o che torna attiva. Annullarla non si ferma mai.
  IF NEW.status IS DISTINCT FROM 'active' OR (TG_OP = 'UPDATE' AND OLD.status = 'active') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('seller_promotions:' || NEW.seller_id::text, 0));

  IF EXISTS (
    SELECT 1
      FROM public.seller_promotions sp
     WHERE sp.seller_id = NEW.seller_id
       AND sp.id <> NEW.id
       AND sp.status = 'active'
       AND sp.title = NEW.title
       AND sp.discount_percent = NEW.discount_percent
       AND sp.scope = NEW.scope
       AND sp.category_id IS NOT DISTINCT FROM NEW.category_id
       AND sp.product_ids IS NOT DISTINCT FROM NEW.product_ids
       AND sp.ends_at > now()
       AND sp.starts_at < NEW.ends_at
       AND sp.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format('Hai già una promo uguale in corso: «%s», -%s%%. Non serve crearla di nuovo.', NEW.title, NEW.discount_percent);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seller_promotions_niente_doppioni() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS seller_promotions_niente_doppioni ON public.seller_promotions;
CREATE TRIGGER seller_promotions_niente_doppioni
  BEFORE INSERT OR UPDATE OF status ON public.seller_promotions
  FOR EACH ROW EXECUTE FUNCTION public.seller_promotions_niente_doppioni();

COMMIT;
