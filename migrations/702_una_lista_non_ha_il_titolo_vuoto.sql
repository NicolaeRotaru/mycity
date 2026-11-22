-- Una lista non ha il titolo vuoto: la regola la tiene anche il database.
--
-- IL DIFETTO. La creazione di una lista (app/lists/page.tsx, components/AddToListButton.tsx) rifiuta
-- un titolo che dopo .trim() resta vuoto; la modifica dalla pagina della lista no, e il database
-- nemmeno: product_lists.title (036) e' solo NOT NULL, quindi '' o '   ' entravano. La pagina adesso
-- controlla, ma la pagina non e' la regola: una chiamata diretta passava lo stesso.
--
-- LA CURA. Un vincolo CHECK con la stessa regola della creazione: il titolo, tolti gli spazi in testa
-- e in coda, non e' vuoto. «Spazi» sono gli stessi che toglie .trim() di JavaScript (spazio,
-- tabulazione, a capo, spazio non separabile e gli altri spazi Unicode), elencati uno per uno: cosi'
-- il database rifiuta esattamente quello che rifiuta la pagina, senza dipendere dalla lingua del server.
--
-- NOT VALID, poi VALIDATE (come la 146): il vincolo vale subito per ogni riga nuova o cambiata; se in
-- produzione ci sono gia' liste senza titolo la validazione non ferma il rilascio, lascia il vincolo
-- NOT VALID e lo grida nei log. La domanda per trovarle e' in fondo.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: ALTER TABLE public.product_lists DROP CONSTRAINT product_lists_titolo_non_vuoto;
-- LA PROVA: tests/sql/rls/riparazione-r08-liste-titolo-vuoto.test.sql.

DO $$ BEGIN
  ALTER TABLE public.product_lists
    ADD CONSTRAINT product_lists_titolo_non_vuoto CHECK (
      btrim(title, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> ''
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE vuote int;
BEGIN
  ALTER TABLE public.product_lists VALIDATE CONSTRAINT product_lists_titolo_non_vuoto;
EXCEPTION WHEN check_violation THEN
  SELECT count(*) INTO vuote FROM public.product_lists
   WHERE btrim(title, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '';
  RAISE WARNING 'product_lists: % liste hanno il titolo vuoto. Il vincolo resta attivo sulle scritture nuove ma NON validato: quelle liste vanno rinominate, poi VALIDATE CONSTRAINT product_lists_titolo_non_vuoto.', vuote;
END $$;

-- Se l'avviso compare nei log, questa trova le liste senza titolo:
--   SELECT id, owner_id, title FROM public.product_lists
--    WHERE btrim(title, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '';
-- Dopo averle sistemate: ALTER TABLE public.product_lists VALIDATE CONSTRAINT product_lists_titolo_non_vuoto;
