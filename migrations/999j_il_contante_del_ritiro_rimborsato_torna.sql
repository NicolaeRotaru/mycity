-- 999j — Il contante di un ritiro al banco rimborsato torna a MyCity (28/11/2026).
--
-- Sul ritiro pagato al banco il negozio tiene in cassa il contante, e il rimborso al cliente lo fa
-- MyCity. Col rimborso pieno l'ordine passa a payout_status = 'REFUNDED' con tutta la quota del
-- negozio in seller_payout_reversed_cents.
--
-- Cosa cambia (stesse firme, stessi permessi):
--  1. public.segna_bonifico_manuale (com'è nella 999i): fra i ritiri da regolare entra anche quello
--     rimborsato per intero, cioè payout_status = 'REFUNDED' con pickup_in_store, consegnato, in
--     contanti, senza payout_at, col reclamo assente o chiuso (RESOLVED o LOST) e senza resi o
--     contestazioni aperti. I conti sono quelli della 999i: commissione (in fattura per il resto) e
--     recupero del rimborso (quota stornata, al massimo il netto; non in fattura). Commissione più
--     recupero meno il credito MyCity usato dal cliente = il contante che il negozio ha in cassa.
--  2. public.contanti_da_recuperare (com'è nella 916): elenca anche i ritiri al banco con un recupero
--     del rimborso non ancora trattenuto: quello che il bonifico non ha coperto, e i rimborsi arrivati
--     dopo il bonifico. Da recuperare = quota stornata (al massimo il netto) − recupero già trattenuto
--     (bonifici_manuali_ordini.recupero_cents).
-- Tabelle, vincoli e le altre funzioni non cambiano.
--
-- Prova: tests/sql/rls/riparazione-s01-ritiro-rimborsato-per-intero.test.sql.
-- Si può rieseguire. NON si applica a mano: lo decide Nicola, dopo la 999i.
-- REVERSIBILE: rieseguire la 999i (segna_bonifico_manuale) e la sezione 5 della 916
-- (contanti_da_recuperare).

BEGIN;

CREATE OR REPLACE FUNCTION public.segna_bonifico_manuale(
  p_seller uuid,
  p_order_ids uuid[],
  p_riferimento text DEFAULT NULL,
  p_ritiri uuid[] DEFAULT '{}'::uuid[],
  p_importo_cents integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_chi uuid := (SELECT auth.uid());
  v_contanti uuid[];
  v_ritiri uuid[];
  v_tutti uuid[];
  v_gia int;
  v_gia_bonifici uuid[];
  v_ok_contanti int;
  v_ok_ritiri int;
  v_contanti_cents bigint;
  v_commissione_cents bigint;
  v_recupero_cents bigint;
  v_recupero_trattenuto bigint;
  v_credito_cents bigint;
  v_trattenuta bigint;
  v_importo bigint;
  v_in_fattura bigint;
  v_rif text;
  v_id uuid;
  v_adesso timestamptz := now();
BEGIN
  IF v_chi IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'bonifico fatto: riservato agli amministratori' USING ERRCODE = '42501';
  END IF;
  IF p_seller IS NULL THEN
    RAISE EXCEPTION 'bonifico fatto: manca il negozio' USING ERRCODE = '22023';
  END IF;
  IF array_position(coalesce(p_order_ids, '{}'::uuid[]), NULL) IS NOT NULL
     OR array_position(coalesce(p_ritiri, '{}'::uuid[]), NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'bonifico fatto: un ordine senza id' USING ERRCODE = '22023';
  END IF;

  v_contanti := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_order_ids, '{}'::uuid[])) AS t(x));
  v_ritiri := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_ritiri, '{}'::uuid[])) AS t(x));
  IF cardinality(v_contanti) + cardinality(v_ritiri) = 0 THEN
    RAISE EXCEPTION 'bonifico fatto: nessun ordine da segnare' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_contanti) + cardinality(v_ritiri) > 5000 THEN
    RAISE EXCEPTION 'bonifico fatto: troppi ordini in una volta' USING ERRCODE = '22023';
  END IF;
  IF v_contanti && v_ritiri THEN
    RAISE EXCEPTION 'bonifico fatto: un ordine non può essere contanti e ritiro insieme' USING ERRCODE = '22023';
  END IF;
  v_tutti := v_contanti || v_ritiri;

  -- Due clic (o due amministratori) insieme: il secondo aspetta il primo su queste righe.
  PERFORM 1 FROM public.orders o WHERE o.id = ANY (v_tutti) ORDER BY o.id FOR UPDATE;

  -- Già in un bonifico? Lo stesso, intero e di questo negozio: è il secondo clic, non si riscrive.
  SELECT count(*), array_agg(DISTINCT l.bonifico_id)
    INTO v_gia, v_gia_bonifici
    FROM private.bonifici_manuali_ordini l
   WHERE l.order_id = ANY (v_tutti);
  IF v_gia > 0 THEN
    IF v_gia = cardinality(v_tutti)
       AND cardinality(v_gia_bonifici) = 1
       AND EXISTS (SELECT 1 FROM private.bonifici_manuali b WHERE b.id = v_gia_bonifici[1] AND b.seller_id = p_seller)
       AND (SELECT count(*) FROM private.bonifici_manuali_ordini l WHERE l.bonifico_id = v_gia_bonifici[1]) = cardinality(v_tutti) THEN
      -- Idempotente solo se coincide tutto: un CRO o una cifra diversi non si accettano in silenzio.
      SELECT b.riferimento, b.importo_cents INTO v_rif, v_importo
        FROM private.bonifici_manuali b WHERE b.id = v_gia_bonifici[1];
      IF (v_importo > 0 AND v_rif IS DISTINCT FROM nullif(btrim(coalesce(p_riferimento, '')), ''))
         OR (p_importo_cents IS NOT NULL AND p_importo_cents <> v_importo) THEN
        RAISE EXCEPTION 'BONIFICO_GIA_SEGNATO: questo bonifico è già scritto col riferimento % e % centesimi',
          coalesce(v_rif, '(nessuno: compensazione)'), v_importo USING ERRCODE = 'P0001';
      END IF;
      RETURN cardinality(v_contanti);
    END IF;
    RAISE EXCEPTION 'BONIFICO_CAMBIATO: % ordini sono già in un altro bonifico', v_gia USING ERRCODE = 'P0001';
  END IF;

  -- I contanti: gli stessi cancelli del pannello e del giro (reso, reclamo, contestazione, rimborso).
  SELECT count(*),
         coalesce(sum(GREATEST(0, coalesce(o.seller_payout_cents, 0) - coalesce(o.seller_payout_reversed_cents, 0))), 0)
    INTO v_ok_contanti, v_contanti_cents
    FROM public.orders o
   WHERE o.id = ANY (v_contanti)
     AND o.seller_id = p_seller
     AND o.payment_method = 'cod'
     AND o.delivery_status = 'DELIVERED'
     AND o.payout_status = 'HELD'
     AND o.seller_payout_cents IS NOT NULL
     AND o.stripe_transfer_id IS NULL
     AND (o.dispute_status IS NULL OR o.dispute_status = 'WON')
     AND (o.internal_dispute_status IS NULL OR o.internal_dispute_status = 'RESOLVED')
     AND coalesce(o.payment_status, '') <> 'REFUNDED'
     AND NOT EXISTS (SELECT 1 FROM public.returns r
                      WHERE r.order_id = o.id AND r.status IN ('REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'))
     AND NOT EXISTS (SELECT 1 FROM public.disputes d
                      WHERE d.order_id = o.id AND d.status IN ('open', 'under_review'));

  -- I ritiri pagati al banco ancora da regolare: gli stessi cancelli dei contanti (reso, reclamo,
  -- contestazione aperti). Il ritiro rimborsato per intero ha payout_status = 'REFUNDED' (lo scrive il
  -- rimborso): si riconosce da pickup_in_store, e il suo reclamo può essere chiuso a favore del
  -- cliente (LOST). Col rimborso, parziale o pieno, il ritiro si regola: il negozio deve
  -- a MyCity la commissione e, a parte, il recupero del rimborso (la sua quota, seller_payout_reversed_cents,
  -- mai oltre il suo netto), perché il contante l'ha tenuto lui e il cliente l'ha rimborsato MyCity.
  -- Per ogni ritiro MyCity deve al negozio il credito usato dal cliente.
  SELECT count(*),
         coalesce(sum(GREATEST(0, coalesce(o.application_fee_cents, 0))), 0),
         coalesce(sum(LEAST(GREATEST(0, coalesce(o.seller_payout_reversed_cents, 0)),
                            GREATEST(0, coalesce(o.seller_payout_cents, 0)))), 0),
         coalesce(sum(GREATEST(0, coalesce(o.wallet_applied_cents, 0))), 0)
    INTO v_ok_ritiri, v_commissione_cents, v_recupero_cents, v_credito_cents
    FROM public.orders o
   WHERE o.id = ANY (v_ritiri)
     AND o.seller_id = p_seller
     AND o.payment_method = 'cod'
     AND o.delivery_status = 'DELIVERED'
     AND o.payout_at IS NULL
     AND (o.dispute_status IS NULL OR o.dispute_status = 'WON')
     AND (
       (o.payout_status = 'CASH_IN_STORE'
        AND (o.internal_dispute_status IS NULL OR o.internal_dispute_status = 'RESOLVED')
        AND coalesce(o.payment_status, '') <> 'REFUNDED')
       OR
       (o.payout_status = 'REFUNDED'
        AND o.pickup_in_store IS TRUE
        AND (o.internal_dispute_status IS NULL OR o.internal_dispute_status IN ('RESOLVED', 'LOST')))
     )
     AND NOT EXISTS (SELECT 1 FROM public.returns r
                      WHERE r.order_id = o.id AND r.status IN ('REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'))
     AND NOT EXISTS (SELECT 1 FROM public.disputes d
                      WHERE d.order_id = o.id AND d.status IN ('open', 'under_review'));

  IF v_ok_contanti <> cardinality(v_contanti) OR v_ok_ritiri <> cardinality(v_ritiri) THEN
    RAISE EXCEPTION 'BONIFICO_CAMBIATO: % ordini non sono più da segnare',
      (cardinality(v_contanti) - v_ok_contanti) + (cardinality(v_ritiri) - v_ok_ritiri)
      USING ERRCODE = 'P0001';
  END IF;
  IF v_contanti_cents + v_credito_cents > 2147483647 OR v_commissione_cents + v_recupero_cents > 2147483647 THEN
    RAISE EXCEPTION 'bonifico fatto: cifra fuori misura' USING ERRCODE = '22003';
  END IF;

  -- Dal bonifico si toglie prima il recupero del rimborso, poi la commissione. Il resto della
  -- commissione va in fattura; il resto del recupero no (si legge fra le quote da recuperare).
  v_trattenuta := LEAST(v_contanti_cents + v_credito_cents, v_commissione_cents + v_recupero_cents);
  v_recupero_trattenuto := LEAST(v_contanti_cents + v_credito_cents, v_recupero_cents);
  v_importo := v_contanti_cents + v_credito_cents - v_trattenuta;
  v_in_fattura := v_commissione_cents - (v_trattenuta - v_recupero_trattenuto);

  IF p_importo_cents IS NOT NULL AND p_importo_cents <> v_importo THEN
    RAISE EXCEPTION 'BONIFICO_CAMBIATO: la cifra da versare è % centesimi, non %', v_importo, p_importo_cents
      USING ERRCODE = 'P0001';
  END IF;

  -- Un bonifico vero vuole il riferimento della banca; una compensazione da 0 € no.
  v_rif := nullif(btrim(coalesce(p_riferimento, '')), '');
  IF v_importo > 0 AND (v_rif IS NULL OR char_length(v_rif) NOT BETWEEN 3 AND 200) THEN
    RAISE EXCEPTION 'bonifico fatto: serve il riferimento del bonifico (CRO/TRN), da 3 a 200 caratteri' USING ERRCODE = '22023';
  END IF;
  IF v_importo = 0 THEN
    v_rif := NULL;
  END IF;

  INSERT INTO private.bonifici_manuali (
    seller_id, fatto_il, fatto_da, riferimento,
    contanti_cents, commissione_cents, credito_cents, trattenuta_cents, importo_cents, in_fattura_cents,
    recupero_cents, recupero_trattenuto_cents
  ) VALUES (
    p_seller, v_adesso, v_chi, v_rif,
    v_contanti_cents::int, v_commissione_cents::int, v_credito_cents::int, v_trattenuta::int, v_importo::int, v_in_fattura::int,
    v_recupero_cents::int, v_recupero_trattenuto::int
  ) RETURNING id INTO v_id;

  -- Il recupero trattenuto si divide fra i ritiri in ordine di id: ognuno prende la sua quota finché
  -- il trattenuto basta.
  INSERT INTO private.bonifici_manuali_ordini (order_id, bonifico_id, tipo, cents, recupero_cents)
  SELECT o.id, v_id, 'contanti', GREATEST(0, coalesce(o.seller_payout_cents, 0) - coalesce(o.seller_payout_reversed_cents, 0)), 0
    FROM public.orders o WHERE o.id = ANY (v_contanti)
  UNION ALL
  SELECT r.id, v_id, 'ritiro', r.commissione,
         GREATEST(0, LEAST(r.recupero, v_recupero_trattenuto - (r.cumulato - r.recupero)))::int
    FROM (SELECT o.id,
                 GREATEST(0, coalesce(o.application_fee_cents, 0)) AS commissione,
                 LEAST(GREATEST(0, coalesce(o.seller_payout_reversed_cents, 0)),
                       GREATEST(0, coalesce(o.seller_payout_cents, 0)))::bigint AS recupero,
                 sum(LEAST(GREATEST(0, coalesce(o.seller_payout_reversed_cents, 0)),
                           GREATEST(0, coalesce(o.seller_payout_cents, 0)))::bigint) OVER (ORDER BY o.id) AS cumulato
            FROM public.orders o WHERE o.id = ANY (v_ritiri)) r;

  UPDATE public.orders
     SET payout_status = 'PAID_MANUALLY',
         payout_at = v_adesso
   WHERE id = ANY (v_contanti);

  UPDATE public.orders
     SET payout_at = v_adesso
   WHERE id = ANY (v_ritiri);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, metadata)
  VALUES (v_chi, 'bonifico_manuale_negozio', 'orders', v_id::text, jsonb_build_object(
    'seller_id', p_seller,
    'contanti', cardinality(v_contanti),
    'ritiri', cardinality(v_ritiri),
    'credito_cents', v_credito_cents,
    'importo_cents', v_importo,
    'trattenuta_cents', v_trattenuta,
    'recupero_cents', v_recupero_cents,
    'recupero_trattenuto_cents', v_recupero_trattenuto,
    'in_fattura_cents', v_in_fattura
  ));

  RETURN cardinality(v_contanti);
END;
$function$;

REVOKE ALL ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], text, uuid[], integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], text, uuid[], integer) FROM anon, service_role;
-- Il controllo vero è dentro (solo amministratori): la pagina la chiama con la sessione dell'amministratore.
GRANT EXECUTE ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], text, uuid[], integer) TO authenticated;

COMMENT ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], text, uuid[], integer) IS
  'Bonifico fatto a mano a un negozio: contanti HELD → PAID_MANUALLY con payout_at e riferimento, commissione dei ritiri al banco e recupero dei rimborsi trattenuti (il recupero non va in fattura), resto della commissione in fattura. Tutto o niente, idempotente sul secondo clic. Solo amministratori (migrazioni 916, 999i e 999j).';

CREATE OR REPLACE FUNCTION public.contanti_da_recuperare()
RETURNS TABLE (
  order_id uuid,
  seller_id uuid,
  store_name text,
  fatto_il timestamptz,
  riferimento text,
  versato_cents integer,
  da_recuperare_cents integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'quote da recuperare: riservate agli amministratori' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT q.oid, q.sid, q.negozio, q.il, q.rif, q.versato, q.da_recuperare
      FROM (
        SELECT l.order_id AS oid, b.seller_id AS sid, p.store_name AS negozio, b.fatto_il AS il,
               b.riferimento AS rif, l.cents AS versato,
               CASE WHEN l.tipo = 'contanti' THEN
                 GREATEST(0, l.cents - CASE
                   WHEN o.payout_status IN ('REFUNDED', 'REVERSED') OR o.payment_status = 'REFUNDED' THEN 0
                   ELSE GREATEST(0, coalesce(o.seller_payout_cents, 0) - coalesce(o.seller_payout_reversed_cents, 0))
                 END)
               ELSE
                 -- Ritiro al banco: il recupero del rimborso dovuto adesso (quota stornata, al massimo
                 -- il netto) meno quanto se n'è già trattenuto col bonifico. La commissione no: quella
                 -- è trattenuta o in fattura.
                 GREATEST(0, LEAST(GREATEST(0, coalesce(o.seller_payout_reversed_cents, 0)),
                                   GREATEST(0, coalesce(o.seller_payout_cents, 0)))
                             - l.recupero_cents)
               END::int AS da_recuperare
          FROM private.bonifici_manuali_ordini l
          JOIN private.bonifici_manuali b ON b.id = l.bonifico_id
          JOIN public.orders o ON o.id = l.order_id
          LEFT JOIN public.profiles p ON p.id = b.seller_id
         WHERE l.tipo IN ('contanti', 'ritiro')
      ) q
     WHERE q.da_recuperare > 0
     ORDER BY q.il DESC, q.oid;
END;
$function$;

REVOKE ALL ON FUNCTION public.contanti_da_recuperare() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.contanti_da_recuperare() FROM anon;
GRANT EXECUTE ON FUNCTION public.contanti_da_recuperare() TO authenticated;

COMMENT ON FUNCTION public.contanti_da_recuperare() IS
  'Contanti versati a mano e poi rimborsati al cliente, e ritiri al banco regolati e poi rimborsati: quanto va ripreso dal negozio, ordine per ordine. Solo amministratori (migrazioni 916 e 999j).';

NOTIFY pgrst, 'reload schema';

COMMIT;
