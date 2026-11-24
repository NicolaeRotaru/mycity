-- 822_la_risposta_del_negozio_avvisa_chi_ha_chiesto.sql
--
-- 24/11/2026 — LE DOMANDE DEI CLIENTI SOTTO I PRODOTTI NON ARRIVAVANO A NESSUNO.
--
-- Il negozio lo avvisa la 821. Restava l'altra meta': quando il negozio risponde
-- (components/ProductQA.tsx, UPDATE di answer su product_questions) l'unico effetto
-- era la riga aggiornata. Chi aveva chiesto («e' senza glutine?») non lo sapeva, e
-- per vedere la risposta doveva tornare da se' sulla scheda del prodotto.
--
-- Qui il database, alla PRIMA risposta a una domanda pubblica, scrive una voce
-- nella campanella di chi l'ha fatta (notifications), col link alla scheda dove la
-- risposta si legge. La campanella diventa anche una push (app/api/cron/send-push).
--   · Una voce sola per domanda: una risposta corretta dopo non avvisa di nuovo.
--   · Nel testo solo il nome del prodotto (pubblico): ne' la risposta ne' chi l'ha scritta.
--   · Chi risponde a una domanda sua non avvisa se stesso.
--   · Categoria 'system', come «Il negozio ti ha risposto» della chat
--     (app/api/chat/messages): un avviso di servizio, non una promozione.
--   · Best-effort: se la voce non si scrive, la risposta resta scritta lo stesso.
-- SECURITY DEFINER perche' notifications non ha una regola d'inserimento: e' il
-- database che scrive, con un testo fisso, al solo autore della domanda. Chi puo'
-- rispondere non cambia (qa_seller_answer, qa_admin_nasconde, guardiano della 215).
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: DROP TRIGGER trg_risposta_avvisa_chi_ha_chiesto ON public.product_questions;
--             DROP FUNCTION public.risposta_avvisa_chi_ha_chiesto();
-- LA PROVA: tests/sql/rls/riparazione-r01-risposta-avvisa-chi-chiede.test.sql.

BEGIN;

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
     OR NEW.author_id IS NOT DISTINCT FROM NEW.answered_by THEN
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

-- La fa scattare il trigger: nessuno la chiama a mano.
REVOKE EXECUTE ON FUNCTION public.risposta_avvisa_chi_ha_chiesto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_risposta_avvisa_chi_ha_chiesto ON public.product_questions;
CREATE TRIGGER trg_risposta_avvisa_chi_ha_chiesto
  AFTER UPDATE OF answer ON public.product_questions
  FOR EACH ROW EXECUTE FUNCTION public.risposta_avvisa_chi_ha_chiesto();

COMMIT;

NOTIFY pgrst, 'reload schema';
