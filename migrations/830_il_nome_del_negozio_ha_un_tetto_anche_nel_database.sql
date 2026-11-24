-- Il nome del negozio ha un tetto anche nel database: 80 caratteri, come nel modulo.
--
-- IL DIFETTO. Il modulo «Dettagli negozio» (components/seller/site/StoreDetailsEditor.tsx) salva il
-- nome direttamente nella tabella dei profili (profiles.store_name), coi permessi del negoziante. Il
-- tetto di 80 caratteri sta solo nel modulo (components/VendorForm.tsx) e nella domanda d'iscrizione
-- (app/api/seller/apply/route.ts): il database non ne ha nessuno, quindi una chiamata diretta salvava
-- un nome di qualunque lunghezza, che poi finisce in vetrina, negli elenchi, nelle email e negli avvisi.
--
-- LA CURA. Un trigger BEFORE INSERT OR UPDATE OF store_name: un nome che nasce o cambia non supera
-- 80 caratteri. L'errore e' 23514 (check_violation), come un vincolo CHECK.
--
-- PERCHE' UN TRIGGER E NON UN CHECK. Un CHECK validato fallirebbe la migrazione se in produzione c'e'
-- gia' un nome piu' lungo (e accorciarlo cambierebbe il nome di un negozio senza dirglielo); un CHECK
-- NOT VALID e' vietato dalla casa (tests/sql/rls/14-le-porte-di-servizio-sono-chiuse.test.sql) e
-- varrebbe per OGNI UPDATE della riga: su un profilo vecchio col nome lungo fallirebbe qualunque
-- scrittura, anche quelle dei pagamenti o dell'approvazione. Il trigger guarda il nome solo quando
-- nasce o quando l'UPDATE lo cambia: le righe vecchie restano scrivibili.
--
-- Il trigger NON e' SECURITY DEFINER: legge solo la riga che si sta scrivendo.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE:
--   DROP TRIGGER IF EXISTS trg_profiles_nome_negozio_con_tetto ON public.profiles;
--   DROP FUNCTION IF EXISTS public.profiles_nome_negozio_con_tetto();
-- LA PROVA: tests/sql/rls/riparazione-r02-nome-negozio-con-tetto.test.sql.

CREATE OR REPLACE FUNCTION public.profiles_nome_negozio_con_tetto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Un UPDATE che riscrive lo stesso nome non lo cambia: le righe vecchie restano modificabili.
  IF TG_OP = 'UPDATE' AND NEW.store_name IS NOT DISTINCT FROM OLD.store_name THEN
    RETURN NEW;
  END IF;

  IF char_length(NEW.store_name) > 80 THEN
    RAISE EXCEPTION 'Il nome del negozio puo'' avere al massimo 80 caratteri'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_nome_negozio_con_tetto ON public.profiles;
CREATE TRIGGER trg_profiles_nome_negozio_con_tetto
  BEFORE INSERT OR UPDATE OF store_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_nome_negozio_con_tetto();

-- I nomi che sono gia' oltre il tetto restano come sono (il trigger non li tocca). Per trovarli:
--   SELECT id, store_name, char_length(store_name) FROM public.profiles WHERE char_length(store_name) > 80;
