-- 995 — Domande dei prodotti: data e firma della risposta (aggiorna la 993)
--
-- domanda_non_si_riscrive (guardiano della 215, stesso trigger), per chi non è
-- amministratore né servizio:
--   · domanda, autore, prodotto, data, id e is_public restano com'erano (come
--     nella 993);
--   · quando la risposta cambia ed è scritta: answered_by = chi scrive
--     (auth.uid()) e answered_at = now();
--   · quando la risposta viene tolta (NULL o solo spazi): answered_by e
--     answered_at tornano NULL;
--   · quando la risposta non cambia: answered_by e answered_at restano com'erano.
-- L'avviso a chi ha chiesto (risposta_avvisa_chi_ha_chiesto, 993) non cambia.
--
-- Si può rieseguire.
--
-- Prova: tests/sql/rls/riparazione-s01-05.test.sql

CREATE OR REPLACE FUNCTION public.domanda_non_si_riscrive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_admin()
     OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
     OR (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.question   IS DISTINCT FROM OLD.question
     OR NEW.author_id  IS DISTINCT FROM OLD.author_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.is_public  IS DISTINCT FROM OLD.is_public THEN
    RAISE EXCEPTION 'La domanda di un cliente non si riscrive: si può solo rispondere.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.answer IS DISTINCT FROM OLD.answer THEN
    IF coalesce(btrim(NEW.answer), '') = '' THEN
      NEW.answered_by := NULL;
      NEW.answered_at := NULL;
    ELSE
      NEW.answered_by := (SELECT auth.uid());
      NEW.answered_at := now();
    END IF;
  ELSE
    NEW.answered_by := OLD.answered_by;
    NEW.answered_at := OLD.answered_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.domanda_non_si_riscrive() FROM PUBLIC, anon, authenticated;
