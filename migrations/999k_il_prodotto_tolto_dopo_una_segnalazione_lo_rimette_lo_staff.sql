-- =============================================================================
-- 999k — Il prodotto tolto dopo una segnalazione accolta lo rimette in vendita solo lo staff
-- =============================================================================
-- IL DIFETTO (R01-010). «Accolta» su una segnalazione di prodotto mette il prodotto in bozza
-- (app/api/admin/segnalazioni/accogli/route.ts) e al venditore parte «il contenuto è stato rimosso».
-- Nessun campo diceva «tolto dallo staff»: il venditore lo rimetteva in vendita da solo con «Attiva»
-- dall'elenco, dal modulo o da una rotta dell'assistente, e la decisione (DSA, art. 16-17) restava
-- solo sulla carta.
--
-- LA CURA.
--   · products.tolto_dallo_staff_at: quando lo staff ha tolto il prodotto per una segnalazione accolta.
--   · Il grilletto prodotto_tolto_lo_rimette_lo_staff:
--       - quel campo lo cambiano solo lo staff (is_admin) e il server (service_role);
--       - con il campo pieno il prodotto non torna 'available', per NESSUNO (anche il server: le rotte
--         dell'assistente scrivono con la chiave di servizio). Rimettere in vendita = la stessa scrittura
--         che svuota il campo (lo fa la rotta admin dei prodotti quando lo staff mette «available»).
--     L'errore che vede il venditore è 23514 col messaggio scritto qui (lib/products/prontoPerLaVendita.ts,
--     erroreDiSalvataggio, lo passa com'è).
--   · Lo sblocco dello staff (campo vuoto) resta anche dopo Disattiva/Attiva.
--   · I prodotti già tolti per una segnalazione accolta e ancora fuori vendita prendono il segno con la
--     data della decisione.
--
-- NON COPRE: le copie nuove (Duplica, importazione): nascono con un INSERT e senza il segno.
-- Da guardare a mano, prima o dopo averla applicata: i prodotti con una segnalazione accolta che sono di
-- nuovo in vendita (li ha rimessi il venditore, o lo staff: il database non lo sa):
--   SELECT p.id, p.name, p.seller_id, s.deciso_at FROM public.products p
--     JOIN public.segnalazioni s ON s.tipo = 'prodotto' AND s.stato = 'accolta' AND s.oggetto_id = p.id
--    WHERE p.status = 'available';
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE:
--   DROP TRIGGER IF EXISTS prodotto_tolto_lo_rimette_lo_staff ON public.products;
--   DROP FUNCTION IF EXISTS public.prodotto_tolto_lo_rimette_lo_staff();
--   ALTER TABLE public.products DROP COLUMN IF EXISTS tolto_dallo_staff_at;
-- =============================================================================

BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tolto_dallo_staff_at timestamptz;

COMMENT ON COLUMN public.products.tolto_dallo_staff_at IS
  'Quando lo staff ha tolto il prodotto dalla vetrina per una segnalazione accolta (DSA). Pieno: il prodotto non torna available finché lo staff non lo svuota (grilletto prodotto_tolto_lo_rimette_lo_staff).';

UPDATE public.products p
   SET tolto_dallo_staff_at = s.deciso_at
  FROM public.segnalazioni s
 WHERE s.tipo = 'prodotto'
   AND s.stato = 'accolta'
   AND s.oggetto_id = p.id
   AND s.deciso_at IS NOT NULL
   AND p.status IS DISTINCT FROM 'available'
   AND p.tolto_dallo_staff_at IS NULL;

CREATE OR REPLACE FUNCTION public.prodotto_tolto_lo_rimette_lo_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.tolto_dallo_staff_at IS DISTINCT FROM OLD.tolto_dallo_staff_at
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo lo staff di MyCity toglie o rimette in vendita un prodotto dopo una segnalazione.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.tolto_dallo_staff_at IS NOT NULL AND NEW.status = 'available' THEN
    RAISE EXCEPTION 'Questo prodotto è stato tolto dalla vetrina dopo una segnalazione accolta: può rimetterlo in vendita solo lo staff di MyCity.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

-- Un grilletto non chiede EXECUTE a chi scrive la riga: nessuno la chiama a mano.
REVOKE ALL ON FUNCTION public.prodotto_tolto_lo_rimette_lo_staff() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prodotto_tolto_lo_rimette_lo_staff ON public.products;
CREATE TRIGGER prodotto_tolto_lo_rimette_lo_staff
  BEFORE UPDATE OF status, tolto_dallo_staff_at ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.prodotto_tolto_lo_rimette_lo_staff();

COMMIT;

NOTIFY pgrst, 'reload schema';
