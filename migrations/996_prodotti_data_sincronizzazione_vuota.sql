-- 996 — Prodotti: data della sincronizzazione esterna all'inserimento (aggiorna la 990)
--
-- Stessa funzione della 990, con una differenza all'INSERT di chi non è
-- amministratore né servizio: external_synced_at vuota resta vuota (prima
-- diventava now()); una data piena resta come nella 990, non oltre now().
--
-- Nota sulla 990: lo snapshot iniziale scritto dal modulo NON si rinnova da
-- solo dopo EXTERNAL_TTL_MS finché gli strumenti AI dei negozi sono spenti
-- (AI_NEGOZI_ACCESA in lib/funzioni-al-lancio.ts): il rinnovo e il cron
-- passano da lì.
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
    IF NEW.external_synced_at IS NOT NULL THEN
      NEW.external_synced_at := least(NEW.external_synced_at, now());
    END IF;
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
