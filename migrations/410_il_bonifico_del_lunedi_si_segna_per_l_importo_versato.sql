-- =============================================================================
-- 410 — Il bonifico del lunedì al negozio si segna, e solo per l'importo versato (R17-002)
-- =============================================================================
-- IL DIFETTO. Al lancio Nicola incassa i contanti e ogni lunedì fa a mano il
-- bonifico al negozio (registro dei fatti: pagamenti.bonifico-contanti-al-negozio).
-- Con la conferma della rimessa l'ordine in contanti passa da
-- AWAITING_REMITTANCE a HELD, e a TRANSFERRED arriva solo con un trasferimento
-- Stripe, spento per i contanti. Nessuna funzione registrava «bonifico a mano
-- fatto»: il negozio leggeva «0,00 € già versati» con l'«in attesa» che
-- cresceva ogni settimana, e Nicola rivedeva «da versare» gli ordini già pagati.
-- Il tasto «Bonifico fatto» del pannello (app/admin/payouts/page.tsx) chiama
-- una funzione che nel database non c'è.
--
-- PERCHÉ NON È LA 350 (tolta il 13/11, collaudo K04). La 350 riceveva solo gli
-- id e segnava in silenzio quelli che passavano i cancelli. Nicola legge 36 €,
-- versa 36 € in banca, intanto su un ordine si apre un reso: l'aggiornamento
-- del pannello porta il tasto a 18 €, la 350 segna un ordine solo, e il lunedì
-- dopo quell'ordine chiede di nuovo 18 €. Pagato due volte.
--
-- LA CURA.
--   ① uno stato nuovo, PAID_MANUALLY, nel vincolo di payout_status;
--   ② la colonna col riferimento del bonifico (payout_manual_ref);
--   ③ via la firma della 350, se un database l'avesse ancora;
--   ④ segna_bonifico_manuale(negozio, ordini, importo versato, riferimento),
--      riservata agli amministratori: TUTTO O NIENTE. Blocca le righe chieste
--      (FOR UPDATE) e, nella stessa transazione:
--        · se uno degli ordini chiesti non passa più i cancelli del giro
--          automatico (contestazione in banca, reclamo, reso o reclamo aperto
--          nelle loro tabelle, rimborso pieno, non è contante HELD consegnato
--          di quel negozio) non segna niente e dice quali (ORDINI_CAMBIATI);
--        · se la somma dei netti (netto meno storni, come il pannello) non è
--          l'importo che Nicola dichiara di aver versato, non segna niente e
--          dice la cifra giusta (IMPORTO_DIVERSO);
--        · richiamata con gli stessi ordini già segnati con lo stesso
--          riferimento (una risposta persa) non scrive niente e lo dice.
--      Ogni bonifico segnato lascia una riga in audit_logs.
-- Il giro dei bonifici Stripe prende solo HELD / PENDING_SELLER_ONBOARDING:
-- PAID_MANUALLY ne resta fuori da solo. Un rimborso dopo il bonifico a mano lo
-- tratta come un bonifico già uscito (lib/stripe/payout.ts, refundOrder).
--
-- Riapplicabile: il vincolo si toglie e si rimette, la colonna «se non c'è»,
-- la funzione «or replace». Non applicata: la applica Nicola.
-- La prova: tests/sql/rls/riparazione-r17-bonifico-del-lunedi.test.sql.
-- =============================================================================

-- ① Lo stato nuovo, con tutti quelli che c'erano (ultima versione: 130).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payout_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payout_status_check
  CHECK (payout_status IS NULL OR payout_status IN (
    'PENDING',
    'HELD',
    'PROCESSING',
    'TRANSFERRED',
    'REFUNDED',
    'FAILED',
    'PENDING_SELLER_ONBOARDING',
    'REVERSED',
    'REVERSAL_FAILED',
    'AWAITING_REMITTANCE',
    'CASH_IN_STORE',
    'PAID_MANUALLY'
  ));

COMMENT ON COLUMN public.orders.payout_status IS
  'Stato del pagamento al venditore. CASH_IN_STORE = ritiro in negozio pagato in contanti: il negozio ha gia'' incassato tutto alla cassa, non gli spetta nessun bonifico e resta da regolare la commissione MyCity. REVERSAL_FAILED = il cliente e'' stato rimborsato ma i soldi dal negozio non sono rientrati: vanno recuperati a mano. PAID_MANUALLY = contanti versati al negozio da Nicola con un bonifico a mano (il lunedi''), segnati da segna_bonifico_manuale().';

-- ② Il riferimento del bonifico.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payout_manual_ref text;

COMMENT ON COLUMN public.orders.payout_manual_ref IS
  'Riferimento (CRO/TRN o data) del bonifico fatto a mano al negozio per i contanti. Scritto solo da segna_bonifico_manuale().';

-- ③ La firma della 350 (solo id, segnava in silenzio una parte): se c'è, via.
DROP FUNCTION IF EXISTS public.segna_bonifico_manuale(uuid, uuid[], text);

-- ④ La funzione.
CREATE OR REPLACE FUNCTION public.segna_bonifico_manuale(
  p_seller uuid,
  p_order_ids uuid[],
  p_importo_cents integer,
  p_riferimento text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rif text := btrim(coalesce(p_riferimento, ''));
  v_chiesti uuid[];
  v_quanti int;
  v_gia int;
  v_segnabili uuid[];
  v_atteso bigint;
  v_fermi uuid[];
  v_segnati int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF length(v_rif) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RIFERIMENTO_MANCANTE');
  END IF;
  IF p_importo_cents IS NULL OR p_importo_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'IMPORTO_MANCANTE');
  END IF;

  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}')
    INTO v_chiesti
    FROM unnest(coalesce(p_order_ids, '{}'::uuid[])) AS x
   WHERE x IS NOT NULL;
  v_quanti := coalesce(array_length(v_chiesti, 1), 0);
  IF p_seller IS NULL OR v_quanti = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NESSUN_ORDINE');
  END IF;

  -- Le righe chieste si bloccano qui, in ordine di id (niente stallo con un
  -- altro giro): da questo punto un rimborso, uno storno o un reclamo scritto
  -- sull'ordine aspetta la fine, e i controlli qui sotto leggono l'ultimo stato.
  PERFORM 1 FROM public.orders WHERE id = ANY (v_chiesti) ORDER BY id FOR UPDATE;

  -- La stessa richiesta già andata a buon fine (la risposta si era persa):
  -- non si riscrive niente, e chi chiama lo sa.
  SELECT count(*) INTO v_gia
    FROM public.orders
   WHERE id = ANY (v_chiesti)
     AND seller_id = p_seller
     AND payout_status = 'PAID_MANUALLY'
     AND payout_manual_ref = v_rif;
  IF v_gia = v_quanti THEN
    RETURN jsonb_build_object('ok', true, 'segnati', 0, 'gia_segnati', v_gia);
  END IF;

  -- Quelli che si possono segnare: contanti con la rimessa confermata (HELD),
  -- consegnati, di QUEL negozio, e gli stessi cancelli del giro automatico
  -- (release-payouts) e del pannello (lib/guadagni/negozio.ts, fermoPerReclamo).
  SELECT coalesce(array_agg(o.id ORDER BY o.id), '{}'),
         coalesce(sum(greatest(0, coalesce(o.seller_payout_cents, 0) - coalesce(o.seller_payout_reversed_cents, 0))), 0)
    INTO v_segnabili, v_atteso
    FROM public.orders o
   WHERE o.id = ANY (v_chiesti)
     AND o.seller_id = p_seller
     AND o.payment_method = 'cod'
     AND o.delivery_status = 'DELIVERED'
     AND o.payout_status = 'HELD'
     AND (o.dispute_status IS NULL OR o.dispute_status = 'WON')
     AND (o.internal_dispute_status IS NULL OR o.internal_dispute_status = 'RESOLVED')
     AND coalesce(o.payment_status, '') <> 'REFUNDED'
     AND NOT EXISTS (SELECT 1 FROM public.returns r
                      WHERE r.order_id = o.id AND r.status IN ('REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'))
     AND NOT EXISTS (SELECT 1 FROM public.disputes d
                      WHERE d.order_id = o.id AND d.status IN ('open', 'under_review'));

  -- Tutto o niente: un ordine chiesto che non si può più segnare ferma tutto.
  v_fermi := ARRAY(SELECT x FROM unnest(v_chiesti) AS x WHERE NOT (x = ANY (v_segnabili)) ORDER BY x);
  IF coalesce(array_length(v_fermi, 1), 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ORDINI_CAMBIATI',
                              'non_segnabili', to_jsonb(v_fermi),
                              'dichiarato_cents', p_importo_cents);
  END IF;

  -- L'importo versato deve essere quello di questi ordini, al centesimo.
  IF v_atteso <> p_importo_cents THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'IMPORTO_DIVERSO',
                              'atteso_cents', v_atteso,
                              'dichiarato_cents', p_importo_cents);
  END IF;

  -- La chiave si alza solo qui, dopo tutti i rifiuti, e si riabbassa subito.
  PERFORM set_config('mycity.allow_order_write', '1', true);
  UPDATE public.orders
     SET payout_status = 'PAID_MANUALLY',
         payout_at = now(),
         payout_manual_ref = v_rif
   WHERE id = ANY (v_segnabili)
     AND payout_status = 'HELD';
  GET DIAGNOSTICS v_segnati = ROW_COUNT;
  PERFORM set_config('mycity.allow_order_write', '', true);

  -- Le righe sono bloccate: non può succedere. Se succede, si torna indietro tutto.
  IF v_segnati <> v_quanti THEN
    RAISE EXCEPTION 'segna_bonifico_manuale: segnati % ordini su %, niente scritto', v_segnati, v_quanti;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, metadata)
  VALUES ((SELECT auth.uid()), 'payout.manual_transfer_marked', 'profiles', p_seller::text,
          jsonb_build_object('ordini', to_jsonb(v_segnabili),
                             'importo_cents', p_importo_cents,
                             'riferimento', v_rif));

  RETURN jsonb_build_object('ok', true, 'segnati', v_segnati, 'importo_cents', v_atteso);
END;
$function$;

REVOKE ALL ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], integer, text) FROM anon;
-- Il controllo vero è is_admin() dentro: la chiama il pannello con la sessione
-- dell'amministratore, così auth.uid() è lui e il registro lo nomina.
GRANT EXECUTE ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], integer, text) TO authenticated;

COMMENT ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], integer, text) IS
  'R17-002: l amministratore segna come pagati a mano (PAID_MANUALLY) i contanti HELD e consegnati di un negozio, tutto o niente: solo se ogni ordine passa i cancelli del giro automatico e la somma dei netti e l importo versato. Riga in audit_logs.';

NOTIFY pgrst, 'reload schema';
