-- 385_l_esito_della_segnalazione_si_comunica_una_volta_per_canale.sql
--
-- R14-021 — Comunicare due volte l'esito di una segnalazione rimandava la mail e le
-- notifiche, e dopo un errore il nuovo tentativo rimandava anche i canali riusciti.
--
-- In `segnalazioni` non c'era nessun segno di cosa e' gia' partito: ne' una colonna
-- ne' un registro (la mail non lascia traccia, la notifica non porta l'id della
-- segnalazione). Tre colonne, una per canale: chi comunica l'esito prima «prende» il
-- canale con un UPDATE condizionato (`... WHERE esito_email_at IS NULL`, che due
-- chiamate insieme non vincono tutte e due), spedisce, e se il canale fallisce lo
-- rimette a NULL. Il nuovo tentativo tocca solo i canali ancora vuoti.
--
-- Se la decisione cambia (stato o motivazione), l'esito e' un altro e va comunicato
-- di nuovo: il trigger azzera i tre segni, a meno che la stessa UPDATE li stia gia'
-- scrivendo.
--
-- Idempotente: si puo' rieseguire.
-- REVERSIBILE: DROP TRIGGER segnalazioni_azzera_esito_comunicato ON public.segnalazioni;
--              DROP FUNCTION public.segnalazioni_azzera_esito_comunicato();
--              ALTER TABLE public.segnalazioni DROP COLUMN esito_email_at,
--                DROP COLUMN esito_notifica_at, DROP COLUMN esito_venditore_at;

ALTER TABLE public.segnalazioni
  ADD COLUMN IF NOT EXISTS esito_email_at     timestamptz,
  ADD COLUMN IF NOT EXISTS esito_notifica_at  timestamptz,
  ADD COLUMN IF NOT EXISTS esito_venditore_at timestamptz;

COMMENT ON COLUMN public.segnalazioni.esito_email_at IS
  'Quando l''email dell''esito e'' partita a chi ha segnalato. NULL = non ancora (R14-021).';
COMMENT ON COLUMN public.segnalazioni.esito_notifica_at IS
  'Quando la notifica dell''esito e'' stata scritta per chi ha segnalato. NULL = non ancora (R14-021).';
COMMENT ON COLUMN public.segnalazioni.esito_venditore_at IS
  'Quando la notifica dell''esito e'' stata scritta per il venditore. NULL = non ancora (R14-021).';

CREATE OR REPLACE FUNCTION public.segnalazioni_azzera_esito_comunicato()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.stato, NEW.esito_motivato) IS DISTINCT FROM (OLD.stato, OLD.esito_motivato)
     AND NEW.esito_email_at     IS NOT DISTINCT FROM OLD.esito_email_at
     AND NEW.esito_notifica_at  IS NOT DISTINCT FROM OLD.esito_notifica_at
     AND NEW.esito_venditore_at IS NOT DISTINCT FROM OLD.esito_venditore_at THEN
    NEW.esito_email_at     := NULL;
    NEW.esito_notifica_at  := NULL;
    NEW.esito_venditore_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS segnalazioni_azzera_esito_comunicato ON public.segnalazioni;
CREATE TRIGGER segnalazioni_azzera_esito_comunicato
  BEFORE UPDATE OF stato, esito_motivato ON public.segnalazioni
  FOR EACH ROW EXECUTE FUNCTION public.segnalazioni_azzera_esito_comunicato();

NOTIFY pgrst, 'reload schema';
