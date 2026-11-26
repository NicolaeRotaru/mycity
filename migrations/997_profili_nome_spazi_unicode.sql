-- 997 — Profili: spazi del nome, classe completa (aggiorna la 992)
--
-- Stessa funzione e stesso trigger della 992, con la classe di caratteri
-- allargata. Ogni sequenza di questi caratteri diventa uno spazio solo, e il
-- nome si scrive senza spazi in testa e in coda:
--   · spazi di Unicode (White_Space): [[:space:]], U+0085, U+00A0, U+1680,
--     U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000;
--   · caratteri di controllo: U+0001–U+001F, U+007F–U+009F;
--   · caratteri invisibili (Default_Ignorable_Code_Point di Unicode):
--     U+00AD, U+034F, U+061C, U+115F, U+1160, U+17B4, U+17B5, U+180B–U+180F,
--     U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+3164, U+FE00–U+FE0F,
--     U+FEFF, U+FFA0, U+FFF0–U+FFF8, U+1BCA0–U+1BCA3, U+1D173–U+1D17A,
--     U+E0000–U+E0FFF;
--   · lo spazio Braille U+2800, che si vede come uno spazio.
-- Un nome che resta vuoto si salva NULL (non '').
--
-- Righe già scritte: l'UPDATE in fondo le rinormalizza. PRIMA DEL RILASCIO
-- contare quante righe cambierà (si lancia anche prima di questa migrazione):
--   SELECT count(*) FROM public.profiles
--    WHERE full_name IS DISTINCT FROM nullif(btrim(regexp_replace(full_name,
--      '[[:space:]\u0001-\u001f\u007f-\u009f\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180f\u2000-\u200f\u2028-\u202f\u205f-\u206f\u2800\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]+', ' ', 'g')), '');
--
-- profiles_nome_normalizzato è una funzione pura (testo → testo): resta
-- eseguibile da tutti perché il trigger gira coi permessi di chi scrive.
--
-- Prova: tests/sql/rls/riparazione-s01-04.test.sql

CREATE OR REPLACE FUNCTION public.profiles_nome_normalizzato(p_nome text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT nullif(btrim(regexp_replace(p_nome,
    '[[:space:]\u0001-\u001f\u007f-\u009f\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180f\u2000-\u200f\u2028-\u202f\u205f-\u206f\u2800\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]+',
    ' ', 'g')), '');
$function$;

CREATE OR REPLACE FUNCTION public.profiles_nome_spazi_normalizzati()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.full_name IS NOT NULL THEN
    NEW.full_name := public.profiles_nome_normalizzato(NEW.full_name);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.profiles_nome_spazi_normalizzati() FROM PUBLIC, anon, authenticated;

UPDATE public.profiles
   SET full_name = full_name
 WHERE full_name IS DISTINCT FROM public.profiles_nome_normalizzato(full_name);
