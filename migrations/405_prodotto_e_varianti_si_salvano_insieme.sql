-- =============================================================================
-- 405 — IL PRODOTTO E LE SUE VARIANTI SI SALVANO INSIEME (R16-004)
-- =============================================================================
-- Il salvataggio di un prodotto con le taglie fa due passi: prima la riga del
-- prodotto (nome, prezzo, scorta), poi le varianti (salva_varianti, 323). Se il
-- secondo passo cade (una taglia venduta proprio in quel momento, la rete che
-- salta) il prezzo nuovo resta scritto e le taglie no. Il ripristino fatto dopo
-- (rimettere i valori di prima) non basta: gli effetti dei trigger della prima
-- scrittura restano (trg_product_price_drop manda ai clienti un «prezzo
-- abbassato» falso, e il limite di un avviso al giorno della 215 ferma poi
-- quello vero), la condizione sulla scorta può bloccare il ripristino, e se la
-- rete è giù cade anche lui.
--
-- Qui i due passi sono una funzione sola, cioè una transazione sola: se una
-- parte non va, non resta scritto niente, nemmeno quello che hanno scritto i
-- trigger (trg_product_price_drop, trg_auto_republish, trg_activity_log,
-- trg_sync_product_variant_rollup scrivono solo righe del database: nessuna
-- chiamata esterna, quindi tornano indietro con il resto).
--
--  · SECURITY INVOKER: valgono le regole per riga di chi chiama, come per le due
--    scritture di prima (il negozio tocca solo i suoi prodotti e le loro
--    varianti; la chiave di servizio dell'amministrazione le scavalca). Sopra,
--    i controlli espliciti:
--      - chi non è la chiave di servizio deve essere il negozio proprietario,
--        approvato (o un amministratore proprietario), come la porta
--        PATCH /api/seller/products/:id;
--      - la lista chiusa delle colonne (quella del negozio; l'amministrazione ha
--        in più negozio e dati esterni): una colonna fuori lista è un errore;
--      - per il negozio il prezzo, se c'è, è maggiore di zero;
--      - la scorta del prodotto, con p_scorta_vista, si scrive solo se è ancora
--        quella vista; quella di una taglia cambiata a mano solo se è ancora
--        quella vista (le stesse regole di salvataggio-tracciato.ts e
--        persistVariantsServer.ts). Le righe sono bloccate per tutta la
--        transazione: fra il controllo e la scrittura non passa nessuna vendita.
--  · Le righe si bloccano nell'ordine di reserve_stock (prima le varianti, poi il
--    prodotto), così una vendita e un salvataggio non si aspettano a vicenda.
--  · p_prodotto: le colonne da scrivere (vuoto = il prodotto non si tocca).
--    p_varianti: l'elenco intero delle varianti come nel modulo,
--    [{id?, options, label, stock}] (NULL = le varianti non si toccano).
--    p_scorte_viste: {id: pezzi} com'erano all'apertura (NULL = senza
--    condizioni, e si cancellano tutte le varianti non più in elenco; con le
--    scorte viste si cancella solo quella che il negoziante ha visto e tolto).
--  · Le scritture delle varianti le fa salva_varianti (323), una copia sola.
--
-- Gli errori (il codice li traduce nel messaggio per chi salva):
--   prodotto_non_tuo (42501) · prodotto_non_trovato (P0002, solo servizio) ·
--   negozio_non_approvato (42501) · colonna_non_ammessa (42501, DETAIL = colonna) ·
--   prezzo_non_valido (22023) · variante_non_valida (22023, DETAIL = etichetta) ·
--   scorta_prodotto_cambiata (P0001, DETAIL = {"vista","adesso"}) ·
--   scorta_variante_cambiata (P0001, DETAIL = {"id","label","vista","adesso"}).
--   Le regole del database (es. il guardiano degli allergeni, 23514) arrivano
--   come sono.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.salva_prodotto_e_varianti(
  p_product_id   uuid,
  p_prodotto     jsonb   DEFAULT '{}'::jsonb,
  p_scorta_vista integer DEFAULT NULL,
  p_varianti     jsonb   DEFAULT NULL,
  p_scorte_viste jsonb   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_servizio  boolean := current_user NOT IN ('anon', 'authenticated') AND (current_user = 'service_role' OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role');
  v_chi       uuid    := auth.uid();
  v_patch     jsonb   := coalesce(p_prodotto, '{}'::jsonb);
  v_ammesse   text[]  := ARRAY['name', 'description', 'price', 'compare_at_price', 'unit', 'condition',
                               'stock', 'category_id', 'images', 'attributes', 'tags', 'express_enabled',
                               'status', 'non_recedibile'];
  v_negozio   uuid;
  v_scorta    integer;
  v_colonna   text;
  v_set       text;
  v_riga      public.products;
  v_esistenti jsonb   := '{}'::jsonb;
  v_var       jsonb;
  v_pos       integer;
  v_id        text;
  v_stock     integer;
  v_vista     numeric;
  v_adesso    integer;
  v_scrivi    boolean;
  v_tenute    text[]  := '{}';
  v_update    jsonb   := '[]'::jsonb;
  v_insert    jsonb   := '[]'::jsonb;
  v_cancella  uuid[];
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'prodotto_mancante' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_patch) <> 'object'
     OR (p_varianti IS NOT NULL AND jsonb_typeof(p_varianti) <> 'array')
     OR (p_scorte_viste IS NOT NULL AND jsonb_typeof(p_scorte_viste) <> 'object') THEN
    RAISE EXCEPTION 'argomenti_non_validi' USING ERRCODE = '22023';
  END IF;

  -- Chi chiama: la chiave di servizio (la rotta dell'amministrazione), oppure un
  -- negozio approvato o un amministratore, che deve essere il proprietario.
  IF NOT v_servizio THEN
    IF v_chi IS NULL THEN
      RAISE EXCEPTION 'prodotto_non_tuo' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_admin() OR public.negozio_approvato(v_chi)) THEN
      RAISE EXCEPTION 'negozio_non_approvato' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_ammesse := v_ammesse || ARRAY['seller_id', 'external_source_url', 'external_marketplace',
                                    'external_data', 'external_synced_at', 'external_sync_status'];
  END IF;

  -- Le righe si bloccano come in reserve_stock: prima le varianti, poi il prodotto.
  IF p_varianti IS NOT NULL THEN
    PERFORM 1 FROM public.product_variants WHERE product_id = p_product_id ORDER BY id FOR UPDATE;
  END IF;
  SELECT p.seller_id, p.stock INTO v_negozio, v_scorta
    FROM public.products p WHERE p.id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    IF v_servizio THEN
      RAISE EXCEPTION 'prodotto_non_trovato' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'prodotto_non_tuo' USING ERRCODE = '42501';
  END IF;
  IF NOT v_servizio AND v_negozio IS DISTINCT FROM v_chi THEN
    RAISE EXCEPTION 'prodotto_non_tuo' USING ERRCODE = '42501';
  END IF;

  -- Il prodotto: lista chiusa delle colonne, prezzo, scorta vista.
  FOR v_colonna IN SELECT jsonb_object_keys(v_patch) LOOP
    IF NOT (v_colonna = ANY (v_ammesse)) THEN
      RAISE EXCEPTION 'colonna_non_ammessa' USING ERRCODE = '42501', DETAIL = v_colonna;
    END IF;
  END LOOP;
  v_riga := jsonb_populate_record(NULL::public.products, v_patch);
  IF NOT v_servizio AND v_patch ? 'price' AND (v_riga.price IS NULL OR v_riga.price <= 0) THEN
    RAISE EXCEPTION 'prezzo_non_valido' USING ERRCODE = '22023';
  END IF;
  IF v_patch ? 'stock' AND p_scorta_vista IS NOT NULL AND v_scorta IS DISTINCT FROM p_scorta_vista THEN
    RAISE EXCEPTION 'scorta_prodotto_cambiata' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('vista', p_scorta_vista, 'adesso', v_scorta)::text;
  END IF;

  -- Le varianti: cosa cancellare, aggiornare e inserire, con le stesse regole di
  -- persistVariantsServer.ts. Tutto controllato prima di scrivere qualunque cosa.
  IF p_varianti IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(v.id::text, v.stock), '{}'::jsonb) INTO v_esistenti
      FROM public.product_variants v WHERE v.product_id = p_product_id;

    FOR v_var, v_pos IN
      SELECT e.value, (e.ordinality - 1)::integer FROM jsonb_array_elements(p_varianti) WITH ORDINALITY AS e
    LOOP
      IF jsonb_typeof(v_var) <> 'object' THEN
        RAISE EXCEPTION 'variante_non_valida' USING ERRCODE = '22023', DETAIL = '';
      END IF;
      -- La scorta scritta: un numero intero non negativo (vuota = 0).
      IF v_var -> 'stock' IS NULL OR jsonb_typeof(v_var -> 'stock') = 'null' THEN
        v_stock := 0;
      ELSIF jsonb_typeof(v_var -> 'stock') = 'number' THEN
        v_stock := greatest(trunc((v_var ->> 'stock')::numeric), 0)::integer;
      ELSE
        RAISE EXCEPTION 'variante_non_valida' USING ERRCODE = '22023', DETAIL = coalesce(v_var ->> 'label', '');
      END IF;

      v_id := nullif(v_var ->> 'id', '');
      IF v_id IS NOT NULL AND v_esistenti ? v_id THEN
        v_tenute := v_tenute || v_id;
        v_vista := CASE WHEN jsonb_typeof(p_scorte_viste -> v_id) = 'number'
                        THEN (p_scorte_viste ->> v_id)::numeric END;
        -- La scorta non toccata (uguale a quella vista) non si riscrive.
        v_scrivi := v_vista IS NULL OR v_stock <> v_vista;
        v_adesso := (v_esistenti ->> v_id)::integer;
        IF v_scrivi AND v_vista IS NOT NULL AND v_adesso IS DISTINCT FROM v_vista THEN
          RAISE EXCEPTION 'scorta_variante_cambiata' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('id', v_id, 'label', v_var ->> 'label',
                                        'vista', v_vista, 'adesso', v_adesso)::text;
        END IF;
        v_update := v_update || jsonb_build_array(
          jsonb_build_object('id', v_id, 'options', v_var -> 'options', 'label', v_var ->> 'label', 'position', v_pos)
          || CASE WHEN v_scrivi THEN jsonb_build_object('stock', v_stock) ELSE '{}'::jsonb END);
      ELSE
        v_insert := v_insert || jsonb_build_array(
          jsonb_build_object('options', v_var -> 'options', 'label', v_var ->> 'label',
                             'stock', v_stock, 'position', v_pos));
      END IF;
    END LOOP;

    -- Si cancella solo la variante che il negoziante ha visto e tolto.
    SELECT coalesce(array_agg(k::uuid), '{}'::uuid[]) INTO v_cancella
      FROM jsonb_object_keys(v_esistenti) AS k
     WHERE NOT (k = ANY (v_tenute))
       AND (p_scorte_viste IS NULL OR p_scorte_viste ? k);
  END IF;

  -- Le scritture: prima il prodotto (coi suoi trigger), poi le varianti.
  IF v_patch <> '{}'::jsonb THEN
    SELECT string_agg(format('%1$I = ($1).%1$I', k), ', ') INTO v_set FROM jsonb_object_keys(v_patch) AS k;
    EXECUTE format('UPDATE public.products SET %s WHERE id = $2', v_set) USING v_riga, p_product_id;
  END IF;
  IF p_varianti IS NOT NULL THEN
    PERFORM public.salva_varianti(p_product_id, v_cancella, v_update, v_insert);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.salva_prodotto_e_varianti(uuid, jsonb, integer, jsonb, jsonb) IS
  'Salva un prodotto e le sue varianti in una transazione sola: se una parte non va non resta scritto niente, nemmeno gli effetti dei trigger. Con le regole per riga di chi chiama, il proprietario approvato (o la chiave di servizio), la lista chiusa delle colonne e le scorte viste.';

REVOKE ALL ON FUNCTION public.salva_prodotto_e_varianti(uuid, jsonb, integer, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salva_prodotto_e_varianti(uuid, jsonb, integer, jsonb, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
