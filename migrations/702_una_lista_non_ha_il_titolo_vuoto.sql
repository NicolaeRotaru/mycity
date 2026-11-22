-- Una lista non ha il titolo vuoto: la regola la tiene anche il database.
--
-- IL DIFETTO. La creazione di una lista (app/lists/page.tsx, components/AddToListButton.tsx) rifiuta
-- un titolo che dopo .trim() resta vuoto; la modifica dalla pagina della lista no, e il database
-- nemmeno: product_lists.title (036) e' solo NOT NULL, quindi '' o '   ' entravano. La pagina adesso
-- controlla, ma la pagina non e' la regola: una chiamata diretta passava lo stesso.
--
-- LA CURA. Un trigger BEFORE INSERT OR UPDATE OF title con la stessa regola della creazione: il
-- titolo, tolti gli spazi in testa e in coda, non e' vuoto. «Spazi» sono gli stessi che toglie
-- .trim() di JavaScript (spazio, tabulazione, a capo, spazio non separabile e gli altri spazi
-- Unicode), elencati uno per uno: cosi' il database rifiuta esattamente quello che rifiuta la
-- pagina, senza dipendere dalla lingua del server. L'errore e' 23514 (check_violation), come un
-- vincolo CHECK.
--
-- PERCHE' UN TRIGGER E NON UN CHECK. Un CHECK, anche NOT VALID, vale per ogni UPDATE della riga:
-- se in produzione c'e' gia' una lista col titolo vuoto, il proprietario che la rende privata
-- (la pagina manda solo is_public e updated_at) riceverebbe un errore e la lista resterebbe
-- pubblica. Il trigger guarda il titolo solo quando nasce una lista o quando l'UPDATE lo cambia:
-- gli UPDATE che non toccano il titolo passano anche sulle righe vecchie col titolo vuoto.
--
-- Il trigger NON e' SECURITY DEFINER: legge solo la riga che si sta scrivendo.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE:
--   DROP TRIGGER IF EXISTS trg_product_lists_titolo_non_vuoto ON public.product_lists;
--   DROP FUNCTION IF EXISTS public.product_lists_titolo_non_vuoto();
-- LA PROVA: tests/sql/rls/riparazione-r08-liste-titolo-vuoto.test.sql.

-- Una versione precedente di questa cura era un CHECK: se c'e', se ne va.
ALTER TABLE public.product_lists DROP CONSTRAINT IF EXISTS product_lists_titolo_non_vuoto;

CREATE OR REPLACE FUNCTION public.product_lists_titolo_non_vuoto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Un UPDATE che riscrive lo stesso titolo non lo cambia: le righe vecchie restano modificabili.
  IF TG_OP = 'UPDATE' AND NEW.title IS NOT DISTINCT FROM OLD.title THEN
    RETURN NEW;
  END IF;

  IF btrim(NEW.title, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' THEN
    RAISE EXCEPTION 'Una lista non puo'' avere il titolo vuoto'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_lists_titolo_non_vuoto ON public.product_lists;
CREATE TRIGGER trg_product_lists_titolo_non_vuoto
  BEFORE INSERT OR UPDATE OF title ON public.product_lists
  FOR EACH ROW EXECUTE FUNCTION public.product_lists_titolo_non_vuoto();

-- Le liste che hanno gia' il titolo vuoto restano come sono (il trigger non le tocca). Per trovarle:
--   SELECT id, owner_id, title FROM public.product_lists
--    WHERE btrim(title, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '';
