-- 930_la_risposta_riscritta_non_riavvisa_chi_ha_chiesto.sql
--
-- 26/11/2026 (R14) — LA RISPOSTA SVUOTATA E RISCRITTA RIAVVISAVA IL CLIENTE OGNI VOLTA.
--
-- La 822 scrive una voce nella campanella di chi ha fatto la domanda alla PRIMA
-- risposta del negozio, e «prima» lo deduceva dalla riga: la risposta di prima era
-- vuota. Ma la risposta il negozio la puo' svuotare dall'API (stessa regola
-- qa_seller_answer del browser: answer a '' o a NULL) e poi riscrivere: ogni giro
-- tornava a essere una prima risposta, e il cliente riceveva una voce (e una push)
-- in piu' ogni volta.
--
-- Adesso il freno non e' la riga, che chi risponde puo' cambiare, ma l'identificativo
-- della voce: si ricava dalla domanda, quindi la seconda «prima risposta» della stessa
-- domanda sbatte sulla chiave primaria di notifications e non scrive niente
-- (ON CONFLICT DO NOTHING). Il resto della 822 resta com'e', parola per parola:
-- quando suona, cosa dice, a chi, best-effort.
--   · Le domande risposte prima di questa migrazione hanno una voce con un
--     identificativo a caso: per loro uno svuota-e-riscrivi puo' avvisare al massimo
--     UNA volta in piu', poi il freno vale anche per loro.
--
-- Si puo' rieseguire. NON si applica a mano: lo decide Nicola, come ogni migrazione.
-- Viene dopo la 822 (ridefinisce la sua funzione; il trigger resta quello della 822).
-- REVERSIBILE: rieseguire la funzione della 822.
-- LA PROVA: tests/sql/rls/riparazione-r14-risposta-riscritta.test.sql.

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
    INSERT INTO public.notifications (id, user_id, category, title, body, link)
    VALUES (
      -- Una voce sola per domanda: lo stesso identificativo a ogni «prima» risposta.
      md5('mycity:risposta-alla-domanda:' || NEW.id::text)::uuid,
      NEW.author_id,
      'system',
      'Il negozio ha risposto alla tua domanda',
      'Su «' || left(coalesce(nullif(btrim(v_prodotto), ''), 'un prodotto'), 80)
        || '»: la risposta la trovi sotto il prodotto.',
      '/product/' || NEW.product_id::text
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort: la risposta resta scritta anche se la campanella non parte
  END;
  RETURN NULL;
END;
$$;

-- La fa scattare il trigger della 822: nessuno la chiama a mano.
REVOKE EXECUTE ON FUNCTION public.risposta_avvisa_chi_ha_chiesto() FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
