-- =============================================================================
-- 323 — LE VARIANTI SI SALVANO TUTTE O NESSUNA (R08-008)
-- =============================================================================
-- Il salvataggio delle varianti di un prodotto (lib/products/persistVariantsServer.ts)
-- faceva tre giri separati: prima cancellava, poi aggiornava una riga alla volta,
-- poi inseriva. Se a metà una scrittura condizionata trovava la scorta cambiata
-- (una vendita arrivata mentre il modulo era aperto), le cancellazioni e gli
-- aggiornamenti già fatti restavano: il prodotto finiva mezzo salvato, e il
-- negoziante leggeva «riapri e salva di nuovo» su un prodotto già cambiato.
--
-- Qui i tre giri sono una funzione sola, cioè una transazione sola: al primo
-- conflitto la funzione alza un errore e il database rimette tutto com'era.
--
--  · SECURITY INVOKER: valgono le regole per riga di chi chiama, come prima
--    (product_variants_modify: il negozio tocca solo le varianti dei suoi
--    prodotti; la chiave di servizio dell'amministrazione le scavalca). Una riga
--    che le regole nascondono non si aggiorna e non dà errore, come prima.
--  · p_update: [{id, options, label, position, stock?, vista?}]. `stock` c'è
--    solo se va riscritto; `vista` è la scorta che il negoziante aveva davanti:
--    se c'è, la riga si aggiorna solo se la scorta è ancora quella, altrimenti
--    errore «scorta_cambiata» con l'id nel DETAIL (il codice lo traduce nel
--    messaggio per il negoziante).
--  · Si tocca solo il prodotto indicato: ogni scrittura filtra product_id.
--
-- Il codice regge anche prima di questa migrazione: se la funzione non c'è
-- (PGRST202) torna ai tre giri di prima.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.salva_varianti(
  p_product_id uuid,
  p_delete     uuid[] DEFAULT '{}',
  p_update     jsonb  DEFAULT '[]',
  p_insert     jsonb  DEFAULT '[]'
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  u      jsonb;
  vista  integer;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'salva_varianti: prodotto mancante' USING ERRCODE = '22023';
  END IF;

  IF coalesce(array_length(p_delete, 1), 0) > 0 THEN
    DELETE FROM public.product_variants
     WHERE product_id = p_product_id AND id = ANY (p_delete);
  END IF;

  FOR u IN SELECT * FROM jsonb_array_elements(coalesce(p_update, '[]'::jsonb)) LOOP
    vista := CASE WHEN u ? 'vista' AND jsonb_typeof(u->'vista') = 'number' THEN (u->>'vista')::integer END;
    UPDATE public.product_variants v
       SET options  = coalesce(u->'options', v.options),
           label    = coalesce(u->>'label', v.label),
           position = coalesce((u->>'position')::integer, v.position),
           stock    = CASE WHEN u ? 'stock' THEN (u->>'stock')::integer ELSE v.stock END
     WHERE v.id = (u->>'id')::uuid
       AND v.product_id = p_product_id
       AND (vista IS NULL OR v.stock = vista);
    IF NOT FOUND AND vista IS NOT NULL THEN
      RAISE EXCEPTION 'scorta_cambiata'
        USING ERRCODE = 'P0001', DETAIL = u->>'id', HINT = 'La scorta della variante è cambiata mentre il modulo era aperto.';
    END IF;
  END LOOP;

  INSERT INTO public.product_variants (product_id, options, label, stock, position)
  SELECT p_product_id,
         coalesce(r->'options', '{}'::jsonb),
         coalesce(r->>'label', ''),
         greatest(coalesce((r->>'stock')::integer, 0), 0),
         coalesce((r->>'position')::integer, 0)
    FROM jsonb_array_elements(coalesce(p_insert, '[]'::jsonb)) AS r;
END;
$$;

COMMENT ON FUNCTION public.salva_varianti(uuid, uuid[], jsonb, jsonb) IS
  'Salva le varianti di un prodotto in una transazione sola (cancella, aggiorna con la scorta vista, inserisce). Con le regole per riga di chi chiama. Errore scorta_cambiata (DETAIL = id) se una scorta vista non c''è più.';

REVOKE ALL ON FUNCTION public.salva_varianti(uuid, uuid[], jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salva_varianti(uuid, uuid[], jsonb, jsonb) TO authenticated, service_role;
