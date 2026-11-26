-- 997 — Profili: spazi del nome, classe completa (aggiorna la 992)
--
-- Stessa funzione e stesso trigger della 992, con la classe di caratteri
-- allargata. Ogni sequenza di questi caratteri diventa uno spazio solo, e il
-- nome si scrive senza spazi in testa e in coda:
--   · spazi di Unicode (White_Space): [[:space:]], U+0085, U+00A0, U+1680,
--     U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000;
--   · caratteri di controllo: U+0001–U+001F, U+007F–U+009F;
--   · caratteri invisibili (Default_Ignorable_Code_Point di Unicode) e di
--     formato (Cf), tranne quelli qui sotto che restano o si tolgono: U+00AD,
--     U+034F, U+0600–U+0605, U+061C, U+06DD, U+070F, U+0890–U+0891, U+08E2,
--     U+115F, U+1160, U+17B4, U+17B5, U+180E, U+200B, U+200E, U+200F,
--     U+202A–U+202E, U+2060–U+206F, U+3164, U+FEFF, U+FFA0, U+FFF0–U+FFFB,
--     U+110BD, U+110CD, U+13430–U+13440, U+16FE4, U+1BCA0–U+1BCA3,
--     U+1D173–U+1D17A, U+E0000–U+E00FF, U+E01F0–U+E0FFF;
--   · caratteri che si vedono come spazi: U+2800, U+13441, U+13442, U+1D159.
-- Restano come sono, perché fanno parte della parola (singalese, devanagari,
-- malayalam, persiano, mongolo, emoji composte): ZWNJ U+200C, ZWJ U+200D e i
-- selettori di forma mongoli U+180B–U+180D, U+180F.
-- I selettori di variante (U+FE00–U+FE0F, U+E0100–U+E01EF) si tolgono senza
-- lasciare uno spazio.
-- Un nome che resta vuoto si salva NULL (non '').
--
-- profiles_nome_spazi fa solo la parte degli spazi; profiles_nome_normalizzato
-- (quella del trigger) toglie prima i selettori di variante. Sono funzioni pure
-- (testo → testo): restano eseguibili da tutti perché il trigger gira coi
-- permessi di chi scrive.
--
-- Righe già scritte: l'UPDATE in fondo tocca solo quelle che cambiano per gli
-- spazi (non quelle che hanno soltanto selettori di variante), e non resta una
-- copia dei nomi di prima. PRIMA DEL RILASCIO guardarle e contarle (si lancia
-- anche prima di questa migrazione):
--   SELECT id, full_name FROM public.profiles
--    WHERE full_name IS DISTINCT FROM
--   nullif(btrim(regexp_replace(full_name,
--       '[[:space:]\u0001-\u001f\u007f-\u009f\u00a0\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f\u1160\u1680\u17b4\u17b5\u180e\u2000-\u200b\u200e-\u200f\u2028-\u202f\u205f-\u206f\u2800\u3000\u3164\ufeff\uffa0\ufff0-\ufffb\U000110bd\U000110cd\U00013430-\U00013442\U00016fe4\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e00ff\U000e01f0-\U000e0fff]+',
--       ' ', 'g')), '');
--
-- Prova: tests/sql/rls/riparazione-s01-04.test.sql

CREATE OR REPLACE FUNCTION public.profiles_nome_spazi(p_nome text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT nullif(btrim(regexp_replace(p_nome,
    '[[:space:]\u0001-\u001f\u007f-\u009f\u00a0\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f\u1160\u1680\u17b4\u17b5\u180e\u2000-\u200b\u200e-\u200f\u2028-\u202f\u205f-\u206f\u2800\u3000\u3164\ufeff\uffa0\ufff0-\ufffb\U000110bd\U000110cd\U00013430-\U00013442\U00016fe4\U0001bca0-\U0001bca3\U0001d159\U0001d173-\U0001d17a\U000e0000-\U000e00ff\U000e01f0-\U000e0fff]+',
    ' ', 'g')), '');
$function$;

CREATE OR REPLACE FUNCTION public.profiles_nome_normalizzato(p_nome text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT public.profiles_nome_spazi(regexp_replace(p_nome,
    '[\ufe00-\ufe0f\U000e0100-\U000e01ef]', '', 'g'));
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
 WHERE full_name IS DISTINCT FROM public.profiles_nome_spazi(full_name);
