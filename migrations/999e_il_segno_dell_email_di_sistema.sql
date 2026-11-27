-- 999e — Il segno dell'email di sistema sui negozi già iscritti (27/11/2026).
--
-- IL DIFETTO (collaudo del 27/11, grave). Il modulo 12 di n8n e il pulsante «Aggiungi attività» iscrivono un
-- negozio con un'email finta, ricavata da nome e città (lib/agenzia/nuova-attivita.ts, emailDiSistema). Quando
-- il titolare accetta il preventivo dal link, la sua email vera prende il posto di quella finta
-- (lib/agenzia/preventivo-col-codice.ts). Da quel momento un nuovo invio dello stesso negozio trovava libera
-- l'email finta e creava un secondo negozio nascosto, col suo secondo link e un secondo avviso a Nicola.
-- La correzione nel codice: ogni utente nuovo nasce col segno `app_metadata.email_di_sistema`, e l'iscrizione
-- cerca l'utente anche da quel segno prima di crearne uno. Gli utenti iscritti PRIMA della correzione il
-- segno non ce l'hanno: questa migrazione lo aggiunge a loro.
--
-- COSA FA. Aggiunge la chiave `email_di_sistema` a `auth.users.raw_app_meta_data` (è l'`app_metadata` di
-- Supabase), solo sugli utenti che hanno un preventivo col codice e non hanno ancora il segno:
--   1. chi ha ancora l'email finta, cioè il titolare non ha accettato: il segno è la sua email;
--   2. chi ha già accettato, se Supabase conserva l'email finta nell'identità «email»
--      (`auth.identities.identity_data`): il segno è quella. Su Supabase vero questo passo non trova quasi
--      nessuno: quando cambia l'email, il server di login (GoTrue, `adminUserUpdate`) riscrive anche
--      l'identità. Resta per chi l'identità vecchia ce l'ha ancora (le prove della CI, un server diverso).
-- Aggiunge una chiave a un oggetto JSON e non toglie niente: email, password, accessi, blocchi, profili e
-- preventivi restano come sono. Nessuna tabella nuova, nessun permesso nuovo.
-- L'email finta ha sempre la forma `<nome>-<10 cifre esadecimali>.preventivo@mycity-system.local`:
-- Ora del Gusto (migrazione 708, `ora-del-gusto.preventivo@…`) non ha quella forma e resta fuori.
--
-- CHI RESTA FUORI. I negozi che hanno già accettato prima della correzione: per quanto detto al punto 2,
-- quasi certamente tutti. L'email finta non si ricostruisce con certezza da qui (il nome in vetrina può
-- essere cambiato all'accettazione). Dopo averla applicata si contano così, una riga per negozio; per
-- ognuno il segno si scrive a mano, con l'email che `emailDiSistema` dà per il nome e la città con cui era
-- stato iscritto:
--   select p.seller_id, p.stato, pr.store_name, pr.city
--   from public.preventivi_con_codice p
--   join auth.users u on u.id = p.seller_id
--   left join public.profiles pr on pr.id = p.seller_id
--   where not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'email_di_sistema');
--
-- SI PUÒ RIESEGUIRE: scrive solo dove il segno manca. Se non ci sono negozi iscritti, non fa niente.
-- COME SI TORNA INDIETRO: si toglie la chiave solo a chi l'ha presa da qui, cioè agli utenti nati PRIMA che
-- la correzione del codice fosse unita (quelli nati dopo l'hanno avuta alla nascita e la devono tenere):
--   update auth.users set raw_app_meta_data = raw_app_meta_data - 'email_di_sistema'
--   where raw_app_meta_data ? 'email_di_sistema' and created_at < '<ora in cui è stata unita la correzione del codice>';
--   Togliendola anche a chi è nato dopo, per lui torna il difetto.
--
-- NUMERO. «999e»: le migrazioni si applicano in ordine di byte (LC_ALL=C sort) e lo script «Migrazioni a mano»
-- accetta tre cifre più una lettera. La 999d è già in main; la 999c sta nella mycity#353, ancora aperta.
-- Questa non dipende da loro e loro non dipendono da questa.
-- NON si applica a mano: lo decide Nicola. Attenzione: il rilascio dopo l'unione applica da solo le
-- migrazioni che mancano (scripts/applica-migrazioni-mancanti.sh), quindi unire questa vuol dire applicarla.

BEGIN;

-- 1. Il titolare non ha ancora accettato: l'email dell'utente è ancora quella finta.
UPDATE auth.users AS u
SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('email_di_sistema', lower(u.email))
WHERE lower(u.email) ~ '^[a-z0-9-]+-[0-9a-f]{10}\.preventivo@mycity-system\.local$'
  AND NOT (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'email_di_sistema')
  AND EXISTS (SELECT 1 FROM public.preventivi_con_codice AS p WHERE p.seller_id = u.id);

-- 2. Il titolare ha già accettato: l'email finta, se c'è ancora, è nell'identità «email».
DO $$
BEGIN
  IF to_regclass('auth.identities') IS NOT NULL THEN
    EXECUTE $upd$
      UPDATE auth.users AS u
      SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                              || jsonb_build_object('email_di_sistema', lower(i.identity_data->>'email'))
      FROM auth.identities AS i
      WHERE i.user_id = u.id
        AND i.provider = 'email'
        AND lower(i.identity_data->>'email') ~ '^[a-z0-9-]+-[0-9a-f]{10}\.preventivo@mycity-system\.local$'
        AND NOT (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'email_di_sistema')
        AND EXISTS (SELECT 1 FROM public.preventivi_con_codice AS p WHERE p.seller_id = u.id)
    $upd$;
  END IF;
END
$$;

COMMIT;
