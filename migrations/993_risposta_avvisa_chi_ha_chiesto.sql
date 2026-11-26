-- 993 — La risposta a una domanda avvisa chi l'ha fatta: chi risponde
--
-- ① risposta_avvisa_chi_ha_chiesto: stessa funzione della 822, riga per riga;
--   la condizione «chi risponde a una domanda sua non avvisa se stesso» guarda
--   auth.uid().
-- ② domanda_non_si_riscrive (guardiano della 215, stesso trigger): per chi non
--   è amministratore né servizio, is_public resta com'è e answered_by è chi
--   scrive la risposta (auth.uid()).
--
-- ORDINE: va applicata DOPO la 900 (che ridefinisce la stessa funzione) e dopo
-- la 822. Si può rieseguire. NON si applica a mano: lo decide Nicola.
--
-- Prova: tests/sql/rls/riparazione-s01-05.test.sql

CREATE OR REPLACE FUNCTION public.risposta_avvisa_chi_ha_chiesto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prodotto text;
BEGIN
  IF NEW.is_public IS NOT TRUE
     OR coalesce(btrim(NEW.answer), '') = ''
     OR coalesce(btrim(OLD.answer), '') <> ''
     OR NEW.author_id IS NOT DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT p.name INTO v_prodotto FROM public.products p WHERE p.id = NEW.product_id;
    INSERT INTO public.notifications (user_id, category, title, body, link)
    VALUES (
      NEW.author_id,
      'system',
      'Il negozio ha risposto alla tua domanda',
      'Su «' || left(coalesce(nullif(btrim(v_prodotto), ''), 'un prodotto'), 80)
        || '»: la risposta la trovi sotto il prodotto.',
      '/product/' || NEW.product_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort: la risposta resta scritta anche se la campanella non parte
  END;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.risposta_avvisa_chi_ha_chiesto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_risposta_avvisa_chi_ha_chiesto ON public.product_questions;
CREATE TRIGGER trg_risposta_avvisa_chi_ha_chiesto
  AFTER UPDATE OF answer ON public.product_questions
  FOR EACH ROW EXECUTE FUNCTION public.risposta_avvisa_chi_ha_chiesto();

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
  IF NEW.answer IS DISTINCT FROM OLD.answer
     OR NEW.answered_by IS DISTINCT FROM OLD.answered_by THEN
    NEW.answered_by := (SELECT auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.domanda_non_si_riscrive() FROM PUBLIC, anon, authenticated;
