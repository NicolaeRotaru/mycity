-- 821_una_domanda_nuova_avvisa_il_negozio.sql
--
-- 24/11/2026 — LE DOMANDE DEI CLIENTI SOTTO I PRODOTTI NON AVVISAVANO IL NEGOZIO.
--
-- Una domanda sotto un prodotto (components/ProductQA.tsx) e' solo una riga di
-- product_questions (027): nessun trigger, nessuna rotta del server, nessuna
-- notifica. Il negozio la scopriva solo aprendo da se' la scheda di quel prodotto,
-- e il cliente aspettava una risposta che nessuno sapeva di dover dare.
--
-- Qui il database, quando nasce una domanda pubblica, scrive una voce nella
-- campanella del negozio del prodotto (notifications), con il link alla scheda dove
-- si risponde. La campanella diventa anche una push (app/api/cron/send-push).
--   · Nessun dato del cliente: ne' il nome ne' il testo della domanda, solo il nome
--     del prodotto (pubblico) e il link.
--   · Una voce non letta per prodotto basta: dieci domande di fila sullo stesso
--     prodotto non fanno dieci campanelle.
--   · Il negozio che chiede sul suo prodotto non avvisa se stesso.
--   · Categoria 'system', come la campanella di un messaggio di un cliente
--     (app/api/chat/messages): un avviso di servizio, non una promozione.
--   · Best-effort: se la voce non si scrive, la domanda resta scritta lo stesso.
-- SECURITY DEFINER perche' notifications non ha una regola d'inserimento: e' il
-- database che scrive, con un testo fisso, al solo negozio del prodotto.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: DROP TRIGGER trg_domanda_avvisa_il_negozio ON public.product_questions;
--             DROP FUNCTION public.domanda_avvisa_il_negozio();
-- LA PROVA: tests/sql/rls/riparazione-r01-domanda-avvisa-il-negozio.test.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.domanda_avvisa_il_negozio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negozio  uuid;
  v_prodotto text;
  v_link     text;
BEGIN
  IF NEW.is_public IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT p.seller_id, p.name INTO v_negozio, v_prodotto
      FROM public.products p
     WHERE p.id = NEW.product_id;
    IF v_negozio IS NULL OR v_negozio = NEW.author_id THEN
      RETURN NULL;
    END IF;
    v_link := '/product/' || NEW.product_id::text;
    IF EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.user_id = v_negozio
         AND n.link = v_link
         AND n.is_read IS NOT TRUE
         AND n.title = 'Nuova domanda su un tuo prodotto'
    ) THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.notifications (user_id, category, title, body, link)
    VALUES (
      v_negozio,
      'system',
      'Nuova domanda su un tuo prodotto',
      'Un cliente ha fatto una domanda su «' || left(coalesce(nullif(btrim(v_prodotto), ''), 'un tuo prodotto'), 80)
        || '». La risposta la scrivi sulla scheda del prodotto, e la vedono tutti.',
      v_link
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort: la domanda resta scritta anche se la campanella non parte
  END;
  RETURN NULL;
END;
$$;

-- La fa scattare il trigger: nessuno la chiama a mano.
REVOKE EXECUTE ON FUNCTION public.domanda_avvisa_il_negozio() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_domanda_avvisa_il_negozio ON public.product_questions;
CREATE TRIGGER trg_domanda_avvisa_il_negozio
  AFTER INSERT ON public.product_questions
  FOR EACH ROW EXECUTE FUNCTION public.domanda_avvisa_il_negozio();

COMMIT;

NOTIFY pgrst, 'reload schema';
