-- 916 — Il «Bonifico fatto» ai negozi resta scritto, con la commissione dei ritiri al banco (26/11/2026).
--
-- Il difetto. Al lancio i contanti li versa Nicola a mano, ogni lunedì, per le consegne della
-- settimana prima (registro dei fatti: pagamenti.bonifico-contanti-al-negozio). Il tasto «Bonifico
-- fatto» di /admin/payouts chiama `segna_bonifico_manuale`, ma nessuna migrazione la crea (i commenti
-- citavano una 350 che non c'è) e il vincolo della 130 su orders.payout_status rifiuta
-- 'PAID_MANUALLY'. Su un database ricostruito dalle migrazioni il bonifico segnato non resta: gli
-- ordini restano HELD e il lunedì dopo tornano «da versare», pagati due volte.
-- E la regola ritiro.in-negozio: sui ritiri pagati in contanti al banco (CASH_IN_STORE) la
-- commissione MyCity si toglie dal bonifico del lunedì; se non basta, va nella fattura del mese.
-- Quella trattenuta non si scriveva da nessuna parte.
--
-- COSA FA.
--  1. orders_payout_status_check: l'elenco della 130 più 'PAID_MANUALLY' (bonifico fatto a mano).
--  2. private.bonifici_manuali — un bonifico (o una compensazione) per riga: negozio, quando, chi,
--     il riferimento della banca (CRO/TRN), i contanti, la commissione dei ritiri al banco, quanto se
--     ne è trattenuto, l'importo davvero versato e il resto che va in fattura. In centesimi interi,
--     mai sotto zero, e i conti tornano per vincolo. Schema `private`: l'API non lo espone.
--     private.bonifici_manuali_ordini — ogni ordine sta in un bonifico solo (chiave = ordine).
--  3. public.segna_bonifico_manuale(negozio, contanti, riferimento, ritiri, importo) — solo un
--     amministratore. Tutto o niente: ogni ordine deve essere ancora del negozio e pagabile (contanti
--     HELD senza reso, reclamo, contestazione o rimborso; ritiri CASH_IN_STORE con la commissione non
--     ancora regolata) e, se la pagina manda l'importo, deve essere quello. Scrive:
--       · i contanti → PAID_MANUALLY con payout_at e il bonifico (riferimento) collegato;
--       · i ritiri al banco → payout_at = quando la commissione è stata regolata (lo stato resta
--         CASH_IN_STORE: il negozio ha già incassato tutto) e il bonifico collegato;
--       · la riga del bonifico con trattenuta = min(contanti, commissione), importo = contanti −
--         trattenuta, in fattura = commissione − trattenuta.
--     Un bonifico da 0 € (commissione ≥ contanti) non vuole il riferimento: è una compensazione, e il
--     resto della commissione resta scritto «in fattura». Un secondo clic sullo stesso bonifico non
--     scrive niente e risponde come il primo. Un passo in audit_logs per ogni bonifico.
--  4. public.bonifici_manuali_per_mese() — i bonifici sommati per negozio e mese (ora di Roma):
--     versato, trattenuto, in fattura. L'amministratore li legge tutti, un negozio solo i suoi.
--  5. public.contanti_da_recuperare() — solo un amministratore: i contanti già versati a mano e poi
--     rimborsati al cliente, con quanto va ripreso dal negozio (il bonifico è partito, non si toglie più).
--  Un ritiro al banco con un reso, un reclamo, una contestazione o un rimborso (anche parziale) non
--  entra nel bonifico, come i contanti. Il secondo clic con un riferimento o una cifra diversi dal primo
--  non passa in silenzio: risponde BONIFICO_GIA_SEGNATO col riferimento già scritto.
--
-- Prove: tests/sql/rls/riparazione-r22-bonifico-fatto.test.sql (la funzione) e
-- tests/sql/rls/riparazione-r22-pagato-a-mano.test.sql (il vincolo).
-- Si può rieseguire. NON si applica a mano: lo decide Nicola.
-- REVERSIBILE:
--   DROP FUNCTION IF EXISTS public.contanti_da_recuperare();
--   DROP FUNCTION IF EXISTS public.bonifici_manuali_per_mese();
--   DROP FUNCTION IF EXISTS public.segna_bonifico_manuale(uuid, uuid[], text, uuid[], integer);
--   DROP TABLE IF EXISTS private.bonifici_manuali_ordini;
--   DROP TABLE IF EXISTS private.bonifici_manuali;
--   e il vincolo della 130 (senza 'PAID_MANUALLY') solo se nessun ordine è PAID_MANUALLY.

BEGIN;

-- 1) Lo stato del bonifico fatto a mano ----------------------------------------------------------
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payout_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payout_status_check
  CHECK (payout_status IS NULL OR payout_status IN (
    'PENDING',
    'HELD',
    'PROCESSING',
    'TRANSFERRED',
    'PAID_MANUALLY',
    'REFUNDED',
    'FAILED',
    'PENDING_SELLER_ONBOARDING',
    'REVERSED',
    'REVERSAL_FAILED',
    'AWAITING_REMITTANCE',
    'CASH_IN_STORE'
  ));

COMMENT ON COLUMN public.orders.payout_status IS
  'Stato del pagamento al venditore. PAID_MANUALLY = contanti versati a mano da MyCity con un bonifico (o compensati con la commissione dei ritiri al banco): il bonifico sta in private.bonifici_manuali (migrazione 916). CASH_IN_STORE = ritiro in negozio pagato in contanti: il negozio ha gia'' incassato tutto alla cassa, non gli spetta nessun bonifico e resta da regolare la commissione MyCity (regolata quando payout_at e'' scritto). REVERSAL_FAILED = il cliente e'' stato rimborsato ma i soldi dal negozio non sono rientrati: vanno recuperati a mano.';

-- 2) Il registro dei bonifici a mano --------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.bonifici_manuali (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  fatto_il timestamptz NOT NULL DEFAULT now(),
  fatto_da uuid NOT NULL,
  riferimento text,
  contanti_cents integer NOT NULL CHECK (contanti_cents >= 0),
  commissione_cents integer NOT NULL CHECK (commissione_cents >= 0),
  trattenuta_cents integer NOT NULL CHECK (trattenuta_cents >= 0),
  importo_cents integer NOT NULL CHECK (importo_cents >= 0),
  in_fattura_cents integer NOT NULL CHECK (in_fattura_cents >= 0),
  CONSTRAINT bonifici_manuali_trattenuta CHECK (trattenuta_cents = LEAST(contanti_cents, commissione_cents)),
  CONSTRAINT bonifici_manuali_importo CHECK (importo_cents = contanti_cents - trattenuta_cents),
  CONSTRAINT bonifici_manuali_in_fattura CHECK (in_fattura_cents = commissione_cents - trattenuta_cents),
  CONSTRAINT bonifici_manuali_riferimento CHECK (
    (importo_cents = 0 AND riferimento IS NULL)
    OR (importo_cents > 0 AND char_length(btrim(riferimento)) BETWEEN 3 AND 200)
  )
);
CREATE INDEX IF NOT EXISTS bonifici_manuali_negozio_idx ON private.bonifici_manuali (seller_id, fatto_il DESC);

CREATE TABLE IF NOT EXISTS private.bonifici_manuali_ordini (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  bonifico_id uuid NOT NULL REFERENCES private.bonifici_manuali(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('contanti', 'ritiro')),
  cents integer NOT NULL CHECK (cents >= 0)
);
CREATE INDEX IF NOT EXISTS bonifici_manuali_ordini_bonifico_idx ON private.bonifici_manuali_ordini (bonifico_id);

ALTER TABLE private.bonifici_manuali ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.bonifici_manuali_ordini ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.bonifici_manuali FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.bonifici_manuali_ordini FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE private.bonifici_manuali IS
  'I bonifici fatti a mano ai negozi (contanti del lunedi'') e le compensazioni con la commissione dei ritiri al banco: importo versato, trattenuta, resto in fattura. Si scrive solo con segna_bonifico_manuale, si legge con bonifici_manuali_per_mese (migrazione 916).';
COMMENT ON TABLE private.bonifici_manuali_ordini IS
  'Gli ordini di ogni bonifico fatto a mano: contanti (netto versato) e ritiri al banco (commissione regolata). Un ordine sta in un bonifico solo (migrazione 916).';

-- 3) «Bonifico fatto» -----------------------------------------------------------------------------
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

  -- I ritiri pagati al banco con la commissione ancora da regolare: gli stessi cancelli dei contanti
  -- (reso, reclamo, contestazione) e nessun rimborso, neanche parziale: la commissione aspetta.
  SELECT count(*), coalesce(sum(GREATEST(0, coalesce(o.application_fee_cents, 0))), 0)
    INTO v_ok_ritiri, v_commissione_cents
    FROM public.orders o
   WHERE o.id = ANY (v_ritiri)
     AND o.seller_id = p_seller
     AND o.payment_method = 'cod'
     AND o.delivery_status = 'DELIVERED'
     AND o.payout_status = 'CASH_IN_STORE'
     AND o.payout_at IS NULL
     AND (o.dispute_status IS NULL OR o.dispute_status = 'WON')
     AND (o.internal_dispute_status IS NULL OR o.internal_dispute_status = 'RESOLVED')
     AND coalesce(o.payment_status, '') NOT IN ('REFUNDED', 'PARTIALLY_REFUNDED')
     AND NOT EXISTS (SELECT 1 FROM public.returns r
                      WHERE r.order_id = o.id AND r.status IN ('REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'))
     AND NOT EXISTS (SELECT 1 FROM public.disputes d
                      WHERE d.order_id = o.id AND d.status IN ('open', 'under_review'));

  IF v_ok_contanti <> cardinality(v_contanti) OR v_ok_ritiri <> cardinality(v_ritiri) THEN
    RAISE EXCEPTION 'BONIFICO_CAMBIATO: % ordini non sono più da segnare',
      (cardinality(v_contanti) - v_ok_contanti) + (cardinality(v_ritiri) - v_ok_ritiri)
      USING ERRCODE = 'P0001';
  END IF;
  IF v_contanti_cents > 2147483647 OR v_commissione_cents > 2147483647 THEN
    RAISE EXCEPTION 'bonifico fatto: cifra fuori misura' USING ERRCODE = '22003';
  END IF;

  v_trattenuta := LEAST(v_contanti_cents, v_commissione_cents);
  v_importo := v_contanti_cents - v_trattenuta;
  v_in_fattura := v_commissione_cents - v_trattenuta;

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
    contanti_cents, commissione_cents, trattenuta_cents, importo_cents, in_fattura_cents
  ) VALUES (
    p_seller, v_adesso, v_chi, v_rif,
    v_contanti_cents::int, v_commissione_cents::int, v_trattenuta::int, v_importo::int, v_in_fattura::int
  ) RETURNING id INTO v_id;

  INSERT INTO private.bonifici_manuali_ordini (order_id, bonifico_id, tipo, cents)
  SELECT o.id, v_id, 'contanti', GREATEST(0, coalesce(o.seller_payout_cents, 0) - coalesce(o.seller_payout_reversed_cents, 0))
    FROM public.orders o WHERE o.id = ANY (v_contanti)
  UNION ALL
  SELECT o.id, v_id, 'ritiro', GREATEST(0, coalesce(o.application_fee_cents, 0))
    FROM public.orders o WHERE o.id = ANY (v_ritiri);

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
    'importo_cents', v_importo,
    'trattenuta_cents', v_trattenuta,
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
  'Bonifico fatto a mano a un negozio: contanti HELD → PAID_MANUALLY con payout_at e riferimento, commissione dei ritiri al banco trattenuta, resto in fattura. Tutto o niente, idempotente sul secondo clic. Solo amministratori (migrazione 916).';

-- 4) Quanto è stato versato, trattenuto e messo in fattura, per mese -------------------------------
CREATE OR REPLACE FUNCTION public.bonifici_manuali_per_mese()
RETURNS TABLE (
  seller_id uuid,
  mese text,
  bonifici integer,
  importo_cents bigint,
  trattenuta_cents bigint,
  in_fattura_cents bigint,
  ultimo_il timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_chi uuid := (SELECT auth.uid());
  v_admin boolean := public.is_admin();
BEGIN
  IF v_chi IS NULL THEN
    RAISE EXCEPTION 'bonifici fatti: serve un accesso' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT b.seller_id,
           to_char(b.fatto_il AT TIME ZONE 'Europe/Rome', 'YYYY-MM'),
           count(*)::int,
           sum(b.importo_cents)::bigint,
           sum(b.trattenuta_cents)::bigint,
           sum(b.in_fattura_cents)::bigint,
           max(b.fatto_il)
      FROM private.bonifici_manuali b
     WHERE v_admin OR b.seller_id = v_chi
     GROUP BY b.seller_id, to_char(b.fatto_il AT TIME ZONE 'Europe/Rome', 'YYYY-MM')
     ORDER BY 2 DESC, 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.bonifici_manuali_per_mese() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bonifici_manuali_per_mese() FROM anon;
GRANT EXECUTE ON FUNCTION public.bonifici_manuali_per_mese() TO authenticated;

COMMENT ON FUNCTION public.bonifici_manuali_per_mese() IS
  'I bonifici fatti a mano sommati per negozio e mese (ora di Roma): versato, trattenuto dai ritiri al banco, in fattura. L amministratore li legge tutti, un negozio solo i suoi (migrazione 916).';

-- 5) Le quote da recuperare dal negozio ----------------------------------------------------------
-- Un contante già versato a mano e poi rimborsato al cliente: il bonifico è partito, quindi la quota
-- del negozio non si toglie più da un bonifico futuro. Va ripresa dal negozio, e la pagina dei
-- bonifici la mostra. Da recuperare = quanto è partito col bonifico − quanto gli spetta adesso
-- (netto meno storni; zero se l'ordine è rimborsato per intero).
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
               GREATEST(0, l.cents - CASE
                 WHEN o.payout_status IN ('REFUNDED', 'REVERSED') OR o.payment_status = 'REFUNDED' THEN 0
                 ELSE GREATEST(0, coalesce(o.seller_payout_cents, 0) - coalesce(o.seller_payout_reversed_cents, 0))
               END)::int AS da_recuperare
          FROM private.bonifici_manuali_ordini l
          JOIN private.bonifici_manuali b ON b.id = l.bonifico_id
          JOIN public.orders o ON o.id = l.order_id
          LEFT JOIN public.profiles p ON p.id = b.seller_id
         WHERE l.tipo = 'contanti'
      ) q
     WHERE q.da_recuperare > 0
     ORDER BY q.il DESC, q.oid;
END;
$function$;

REVOKE ALL ON FUNCTION public.contanti_da_recuperare() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.contanti_da_recuperare() FROM anon;
GRANT EXECUTE ON FUNCTION public.contanti_da_recuperare() TO authenticated;

COMMENT ON FUNCTION public.contanti_da_recuperare() IS
  'Contanti versati a mano e poi rimborsati al cliente: quanto va ripreso dal negozio, ordine per ordine. Solo amministratori (migrazione 916).';

NOTIFY pgrst, 'reload schema';

COMMIT;
