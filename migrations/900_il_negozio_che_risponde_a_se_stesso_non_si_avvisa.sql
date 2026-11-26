-- 900_il_negozio_che_risponde_a_se_stesso_non_si_avvisa.sql
--
-- 26/11/2026 — IL NEGOZIO CHE RISPONDEVA ALLA PROPRIA DOMANDA SI AVVISAVA DA SOLO.
--
-- La 822 scrive nella campanella di chi ha chiesto «Il negozio ha risposto alla
-- tua domanda». Per non avvisare il negozio che risponde a una domanda sua
-- guardava answered_by: ma answered_by lo manda il browser
-- (components/ProductQA.tsx). Se arriva vuoto, il negozio che aveva scritto la
-- domanda sul suo prodotto e poi rispondeva si trovava l'avviso a se stesso.
--
-- Qui la funzione e' la stessa della 822 (nessuna migrazione dopo l'ha cambiata),
-- con un controllo in piu' che non dipende dal browser: se chi ha chiesto e' il
-- negozio del prodotto, l'avviso non parte. Il testo «Il negozio ha risposto»
-- non ha senso per il negozio stesso, chiunque scriva la risposta.
-- Le domande dei clienti, e quelle di un negozio sul prodotto di un ALTRO negozio,
-- avvisano come prima, anche senza answered_by.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- REVERSIBILE: rieseguire migrations/822_la_risposta_del_negozio_avvisa_chi_ha_chiesto.sql.
-- LA PROVA: tests/sql/rls/riparazione-r13-risposta-a-se-stesso.test.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.risposta_avvisa_chi_ha_chiesto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prodotto text;
  v_negozio uuid;
BEGIN
  IF NEW.is_public IS NOT TRUE
     OR coalesce(btrim(NEW.answer), '') = ''
     OR coalesce(btrim(OLD.answer), '') <> ''
     OR NEW.author_id IS NOT DISTINCT FROM NEW.answered_by THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT p.name, p.seller_id INTO v_prodotto, v_negozio FROM public.products p WHERE p.id = NEW.product_id;
    -- Chi ha chiesto e' il negozio del prodotto: risponde a se stesso, anche senza answered_by.
    IF NEW.author_id IS NOT DISTINCT FROM v_negozio THEN
      RETURN NULL;
    END IF;
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

COMMIT;

NOTIFY pgrst, 'reload schema';
