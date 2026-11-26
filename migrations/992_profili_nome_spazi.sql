-- 992 — Profili: spazi del nome
--
-- full_name si salva con gli spazi normalizzati: ogni sequenza della classe
-- di spazi scritta sotto (tabulazione, a capo, U+00A0, U+2000–U+200B, U+202F,
-- U+3000, U+FEFF…) diventa uno spazio solo, e il nome si scrive senza spazi
-- in testa e in coda. Vale per l'inserimento e per ogni aggiornamento del nome,
-- e per le righe già scritte (UPDATE qui sotto).
-- nomi_pubblici, rider_reviews_ricevute e get_referral_leaderboard() restano
-- come sono: la prima parola la prendono sullo spazio.
--
-- La 997 allarga la classe (tutti gli spazi di Unicode, i caratteri invisibili
-- e i riempitivi) e salva NULL un nome rimasto vuoto: vale la 997.
--
-- Prova: tests/sql/rls/riparazione-s01-04.test.sql

CREATE OR REPLACE FUNCTION public.profiles_nome_spazi_normalizzati()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.full_name IS NOT NULL THEN
    NEW.full_name := btrim(regexp_replace(NEW.full_name,
      '[[:space:]   -​    　﻿]+', ' ', 'g'));
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.profiles_nome_spazi_normalizzati() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_nome_spazi_normalizzati ON public.profiles;
CREATE TRIGGER trg_profiles_nome_spazi_normalizzati
  BEFORE INSERT OR UPDATE OF full_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_nome_spazi_normalizzati();

UPDATE public.profiles
   SET full_name = full_name
 WHERE full_name IS DISTINCT FROM btrim(regexp_replace(full_name,
         '[[:space:]   -​    　﻿]+', ' ', 'g'));
