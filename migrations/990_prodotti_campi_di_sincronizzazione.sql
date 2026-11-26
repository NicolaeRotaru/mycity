-- 990 — Prodotti: colonne della sincronizzazione esterna
--
-- external_source_url, external_marketplace, external_data, external_synced_at
-- ed external_sync_status di un prodotto esistente si aggiornano dalle rotte
-- del server (chiave di servizio) e dallo staff, come in
-- salva_prodotto_e_varianti (405, 709).
--
-- Passano: is_admin() e i ruoli diversi da anon / authenticated (service_role,
-- proprietario del database, funzioni SECURITY DEFINER).
-- Per gli altri:
--   UPDATE — se cambia una di queste colonne esce con 42501; lo stesso valore
--            rimandato passa;
--   INSERT — lo snapshot iniziale del modulo resta; external_sync_status parte
--            da 'idle' e external_synced_at non va oltre now(). Il rinnovo a
--            scadenza (EXTERNAL_TTL_MS) c'è solo con gli strumenti AI dei
--            negozi accesi. La 996 aggiorna questa funzione: vale la 996.
--
-- Prova: tests/sql/rls/riparazione-s01-01.test.sql

CREATE OR REPLACE FUNCTION public.products_campi_sincronizzazione_dal_server()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.external_sync_status := 'idle';
    NEW.external_synced_at   := least(NEW.external_synced_at, now());
    RETURN NEW;
  END IF;

  IF NEW.external_source_url  IS DISTINCT FROM OLD.external_source_url
  OR NEW.external_marketplace IS DISTINCT FROM OLD.external_marketplace
  OR NEW.external_data        IS DISTINCT FROM OLD.external_data
  OR NEW.external_synced_at   IS DISTINCT FROM OLD.external_synced_at
  OR NEW.external_sync_status IS DISTINCT FROM OLD.external_sync_status THEN
    RAISE EXCEPTION 'products: campo di sincronizzazione riservato al server' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.products_campi_sincronizzazione_dal_server() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_products_campi_sincronizzazione ON public.products;
CREATE TRIGGER trg_products_campi_sincronizzazione
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_campi_sincronizzazione_dal_server();
