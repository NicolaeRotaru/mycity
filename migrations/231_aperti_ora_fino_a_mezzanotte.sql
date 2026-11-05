-- =============================================================================
-- 231 — «Aperti ora»: il negozio che chiude a mezzanotte è aperto la sera
-- =============================================================================
-- IL DIFETTO. Un negozio con orario 18:00–00:00 (per dire «fino a mezzanotte»)
-- non risultava mai aperto: `ora < '00:00'` non è vero per nessuna ora. La
-- scheda e la cassa ora lo leggono come aperto fino a fine giornata
-- (lib/store-hours.ts, intervalloInMinuti); il filtro «Aperti ora» delle
-- liste, che chiede a questa funzione, lo escludeva ancora.
--
-- LA CORREZIONE. Stessa funzione della 127, con la chiusura «00:00» (o
-- «24:00») letta come mezzanotte. Nessun'altra riga cambia.
--
-- RITORNO INDIETRO (down): rieseguire il blocco CREATE OR REPLACE FUNCTION
-- public.negozi_aperti_adesso della migrazione 127. Nessun dato viene toccato.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.negozi_aperti_adesso()
RETURNS TABLE(seller_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  adesso timestamptz := now();
  ora_locale time := (adesso AT TIME ZONE 'Europe/Rome')::time;
  giorno text := lower(to_char(adesso AT TIME ZONE 'Europe/Rome', 'Dy'));
BEGIN
  RETURN QUERY
  SELECT s.id
    FROM public.seller_public_profiles s
   WHERE s.store_hours IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(
                COALESCE(s.store_hours -> giorno, '[]'::jsonb)
              ) AS fascia
        WHERE jsonb_array_length(fascia) = 2
          AND (fascia ->> 0) ~ '^[0-9]{1,2}:[0-9]{2}$'
          AND (fascia ->> 1) ~ '^[0-9]{1,2}:[0-9]{2}$'
          AND ora_locale >= (fascia ->> 0)::time
          -- 231: una chiusura a mezzanotte («00:00» o «24:00») vale «fino a fine giornata»,
          -- come in lib/store-hours.ts (intervalloInMinuti).
          AND (ora_locale < (fascia ->> 1)::time OR (fascia ->> 1) IN ('00:00', '0:00', '24:00'))
     );
END;
$function$;

COMMENT ON FUNCTION public.negozi_aperti_adesso() IS
  'I negozi aperti in questo momento. Il giorno e l ora sono quelli di Piacenza, '
  'non di Greenwich. Serve a far tagliare il filtro «aperto adesso» al database '
  'invece che al browser, dove accorciava l elenco in silenzio.';

GRANT EXECUTE ON FUNCTION public.negozi_aperti_adesso() TO anon, authenticated;
