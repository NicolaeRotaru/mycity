-- =============================================================================
-- 191 — LA POSIZIONE DEL FATTORINO NON SI SCRIVE SU UN ORDINE CHIUSO
-- =============================================================================
-- 01/11/2026.
--
-- IL DIFETTO. La 126 ha messo un guardiano (`ordini_cancella_posizione_a_chiusura`)
-- che cancella rider_lat / rider_lng / rider_position_updated_at quando l'ordine
-- diventa DELIVERED o CANCELED. Ma scatta solo su `UPDATE OF delivery_status`:
-- se dopo la chiusura arriva un UPDATE che scrive SOLO la posizione, il
-- guardiano non parte. La regola RLS del fattorino (161) esclude solo
-- DELIVERED, non CANCELED, e `enforce_order_update_rules` lascia scrivere la
-- posizione al fattorino assegnato. Risultato: una scheda rimasta aperta o un
-- client vecchio continua a salvare la posizione (un dato personale) su un
-- ordine annullato, contro la promessa dell'informativa privacy.
--
-- LA CORREZIONE. Lo stesso guardiano, con la stessa funzione, scatta anche
-- quando l'UPDATE tocca una delle tre colonne della posizione. Su un ordine
-- chiuso la posizione nuova viene azzerata prima di essere scritta. Non si
-- alza un errore: un client vecchio che manda la posizione ogni pochi secondi
-- non deve riempire i log ne' rompere la pagina, deve solo non lasciare traccia.
--
-- PERCHE' NON LA REGOLA RLS. Aggiungere CANCELED al WITH CHECK della regola
-- del fattorino chiuderebbe anche altre scritture del fattorino su un ordine
-- annullato che oggi nessuno ha verificato; il guardiano tocca solo le tre
-- colonne della posizione, quindi non puo' rompere altri passi.
--
-- ORDINE DEI GUARDIANI. I trigger BEFORE scattano in ordine alfabetico:
-- `ordini_cancella_posizione_a_chiusura` gira prima di `trg_enforce_order_update`,
-- che quindi vede la posizione gia' azzerata.
--
-- ROLLBACK: rimettere il trigger com'era nella 126:
--   DROP TRIGGER IF EXISTS ordini_cancella_posizione_a_chiusura ON public.orders;
--   CREATE TRIGGER ordini_cancella_posizione_a_chiusura
--     BEFORE UPDATE OF delivery_status ON public.orders
--     FOR EACH ROW EXECUTE FUNCTION public.cancella_posizione_a_ordine_chiuso();
-- =============================================================================

DROP TRIGGER IF EXISTS ordini_cancella_posizione_a_chiusura ON public.orders;
CREATE TRIGGER ordini_cancella_posizione_a_chiusura
  BEFORE UPDATE OF delivery_status, rider_lat, rider_lng, rider_position_updated_at ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.cancella_posizione_a_ordine_chiuso();

-- Ordini gia' chiusi che nel frattempo hanno ricevuto una posizione: si azzera ora.
UPDATE public.orders
   SET rider_lat = NULL, rider_lng = NULL, rider_position_updated_at = NULL
 WHERE delivery_status IN ('DELIVERED', 'CANCELED')
   AND (rider_lat IS NOT NULL OR rider_lng IS NOT NULL OR rider_position_updated_at IS NOT NULL);
