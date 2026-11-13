-- 377 — La posizione del negozio sta nell'area di Piacenza
--
-- Il difetto (R13-006): nessun punto della catena sapeva dove sta Piacenza. Il
-- selettore della posizione confermava qualunque punto trovato dalle mappe
-- («Via Roma 12» senza la città = la prima Via Roma d'Italia), il profilo del
-- negozio scrive le coordinate dal browser così come arrivano, e il database le
-- prendeva tutte. Un negozio messo a Roma veniva approvato, e poi ogni ordine
-- era «fuori zona» senza che nessuno gli dicesse perché.
--
-- La cura: una posizione del negozio NUOVA o CAMBIATA deve cadere nel riquadro
-- di Piacenza e dintorni, lo stesso di `RIQUADRO_PIACENZA` in
-- lib/ordini/zona-di-consegna.ts (chi cambia l'uno cambia l'altro). Una
-- posizione già salvata che non cambia non si guarda: chi salva solo telefono e
-- orari non viene fermato. Vale per tutti, anche per la chiave di servizio
-- (/api/seller/apply fa lo stesso controllo prima di scrivere). Il vuoto resta
-- permesso: un negozio senza posizione non ha consegne da misurare.
CREATE OR REPLACE FUNCTION public.posizione_del_negozio_a_piacenza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.store_lat IS NULL OR NEW.store_lng IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.store_lat IS NOT DISTINCT FROM OLD.store_lat
     AND NEW.store_lng IS NOT DISTINCT FROM OLD.store_lng THEN
    RETURN NEW;
  END IF;
  IF NEW.store_lat BETWEEN 44.97 AND 45.1 AND NEW.store_lng BETWEEN 9.57 AND 9.86 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La posizione del negozio è fuori dall''area di Piacenza che serviamo.'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS posizione_del_negozio_a_piacenza ON public.profiles;
CREATE TRIGGER posizione_del_negozio_a_piacenza
  BEFORE INSERT OR UPDATE OF store_lat, store_lng ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.posizione_del_negozio_a_piacenza();
