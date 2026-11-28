-- 999i — «Bonifico fatto»: il ritiro al banco rimborsato in parte si regola (28/11/2026).
--
-- Cosa cambia rispetto alla 916, solo in public.segna_bonifico_manuale (stessa firma, stessi permessi):
--  · un ritiro pagato al banco (CASH_IN_STORE) con payment_status = 'PARTIALLY_REFUNDED' entra nel
--    bonifico come gli altri ritiri. Resta fuori solo col rimborso pieno o con un reso, un reclamo o
--    una contestazione aperti, come i contanti;
--  · per ogni ritiro il negozio deve la commissione (application_fee_cents) e, a parte, il recupero
--    del rimborso: la sua quota dei rimborsi già scritta sull'ordine (seller_payout_reversed_cents, al
--    massimo seller_payout_cents). Il recupero non è una commissione e non va in fattura:
--      · commissione_cents e in_fattura_cents restano la sola commissione;
--      · recupero_cents è il recupero dovuto, recupero_trattenuto_cents quanto se ne toglie dal
--        bonifico (prima del recupero, poi della commissione); il resto del recupero si legge fra le
--        quote da recuperare (999j), il resto della commissione va in fattura come nella 916.
--    In bonifici_manuali_ordini il ritiro porta cents = commissione e recupero_cents = la sua parte
--    del recupero trattenuto.
--  · private.bonifici_manuali e private.bonifici_manuali_ordini: le colonne del recupero e i vincoli
--    dei conti (trattenuta, recupero, in fattura) rifatti con il recupero. Le righe già scritte hanno
--    recupero 0 e rispettano i vincoli nuovi.
-- Le altre funzioni della 916 non cambiano.
--
-- Prove: tests/sql/rls/riparazione-s01-ritiro-rimborsato-in-parte.test.sql e
-- tests/sql/rls/riparazione-r22-bonifico-cancelli.test.sql.
-- Si può rieseguire. NON si applica a mano: lo decide Nicola.
-- REVERSIBILE: rieseguire la sezione 3 della 916 (la funzione com'era), poi rimettere i vincoli
-- bonifici_manuali_trattenuta e bonifici_manuali_in_fattura della 916, togliere
-- bonifici_manuali_recupero e le colonne recupero_cents / recupero_trattenuto_cents (solo se tutte a 0).

BEGIN;

-- Il recupero del rimborso, a parte dalla commissione ------------------------------------------------
ALTER TABLE private.bonifici_manuali
  ADD COLUMN IF NOT EXISTS recupero_cents integer NOT NULL DEFAULT 0 CHECK (recupero_cents >= 0),
  ADD COLUMN IF NOT EXISTS recupero_trattenuto_cents integer NOT NULL DEFAULT 0 CHECK (recupero_trattenuto_cents >= 0);
ALTER TABLE private.bonifici_manuali DROP CONSTRAINT IF EXISTS bonifici_manuali_trattenuta;
ALTER TABLE private.bonifici_manuali DROP CONSTRAINT IF EXISTS bonifici_manuali_recupero;
ALTER TABLE private.bonifici_manuali DROP CONSTRAINT IF EXISTS bonifici_manuali_in_fattura;
ALTER TABLE private.bonifici_manuali
  ADD CONSTRAINT bonifici_manuali_trattenuta
    CHECK (trattenuta_cents = LEAST(contanti_cents + credito_cents, commissione_cents + recupero_cents)),
  ADD CONSTRAINT bonifici_manuali_recupero
    CHECK (recupero_trattenuto_cents = LEAST(contanti_cents + credito_cents, recupero_cents)),
  ADD CONSTRAINT bonifici_manuali_in_fattura
    CHECK (in_fattura_cents = commissione_cents - (trattenuta_cents - recupero_trattenuto_cents));

ALTER TABLE private.bonifici_manuali_ordini
  ADD COLUMN IF NOT EXISTS recupero_cents integer NOT NULL DEFAULT 0 CHECK (recupero_cents >= 0);

COMMENT ON COLUMN private.bonifici_manuali.recupero_cents IS
  'Il recupero dei rimborsi dei ritiri al banco: la quota del negozio nei rimborsi fatti da MyCity (al massimo il suo netto). Non è commissione e non va in fattura (migrazione 999i).';
COMMENT ON COLUMN private.bonifici_manuali.recupero_trattenuto_cents IS
  'Quanto del recupero si è tolto dal bonifico; il resto si legge fra le quote da recuperare (migrazioni 999i, 999j).';
COMMENT ON COLUMN private.bonifici_manuali_ordini.recupero_cents IS
  'Per un ritiro: la sua parte del recupero trattenuto dal bonifico (migrazione 999i).';

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
  -- contestazione aperti, rimborso pieno). Col rimborso parziale il ritiro si regola: il negozio deve
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
     AND o.payout_status = 'CASH_IN_STORE'
     AND o.payout_at IS NULL
     AND (o.dispute_status IS NULL OR o.dispute_status = 'WON')
     AND (o.internal_dispute_status IS NULL OR o.internal_dispute_status = 'RESOLVED')
     AND coalesce(o.payment_status, '') <> 'REFUNDED'
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
  'Bonifico fatto a mano a un negozio: contanti HELD → PAID_MANUALLY con payout_at e riferimento, commissione dei ritiri al banco e recupero dei rimborsi trattenuti (il recupero non va in fattura), resto della commissione in fattura. Tutto o niente, idempotente sul secondo clic. Solo amministratori (migrazioni 916 e 999i).';

NOTIFY pgrst, 'reload schema';

COMMIT;
