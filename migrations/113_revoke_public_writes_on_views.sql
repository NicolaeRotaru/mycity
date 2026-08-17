-- 113: toglie ad anon/authenticated la scrittura sulle viste pubbliche di sola lettura.
--
-- Difetto trovato il 17/08/2026 in produzione. Su Supabase i default privileges
-- dello schema public concedono ALL a anon/authenticated su OGNI nuovo oggetto:
-- le viste nascono quindi con INSERT/UPDATE/DELETE/TRUNCATE anche quando servono
-- solo in lettura. Una vista semplice (SELECT da una sola tabella, senza
-- aggregazioni) e' auto-aggiornabile, e senza security_invoker i controlli sulla
-- tabella base avvengono con i privilegi del PROPRIETARIO della vista: la RLS
-- della tabella sottostante viene scavalcata.
--
-- Conseguenza concreta: chiunque abbia la chiave anon — che e' pubblica, sta nel
-- bundle del browser — poteva modificare i profili dei negozi approvati passando
-- da public.seller_public_profiles.
--
-- Provato in transazione con ROLLBACK sul database di produzione:
--   BEGIN; SET LOCAL ROLE anon;
--   UPDATE public.seller_public_profiles SET store_name = '...' WHERE id = '...';
--   -- l'UPDATE andava a buon fine e il nome del negozio cambiava davvero
--   ROLLBACK;
-- Dopo questa migration la stessa UPDATE fallisce con insufficient_privilege.
--
-- Nessun percorso dell'applicazione scrive su queste viste (zero
-- insert/update/delete/upsert nel codice), quindi il comportamento non cambia:
-- resta il SELECT, che e' quanto serve alla vetrina pubblica.
--
-- ⚠️ Da ripetere dopo ogni DROP+CREATE di una vista pubblica: i default
-- privileges riassegnano ALL alla ricreazione.

-- Solo sulle viste che esistono: `seller_storefronts` vive in produzione ma in
-- nessuna migrazione (deriva), quindi su un database ricostruito da zero non
-- c'e' — e un REVOKE su un oggetto assente interrompeva il file.
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'public.seller_public_profiles',
    'public.public_profiles',
    'public.seller_storefronts',
    'public.referral_leaderboard',
    'public.shop_of_month_leaderboard'
  ] LOOP
    IF to_regclass(v) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON %s FROM anon, authenticated', v);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
