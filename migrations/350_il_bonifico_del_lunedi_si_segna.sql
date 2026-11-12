-- =============================================================================
-- 350 — Il bonifico del lunedì al negozio si può segnare (R11-004)
-- =============================================================================
-- IL DIFETTO. Al lancio Nicola incassa i contanti e ogni lunedì fa a mano il
-- bonifico al negozio (registro dei fatti: pagamenti.bonifico-contanti-al-negozio).
-- Con la conferma della rimessa l'ordine in contanti passa da
-- AWAITING_REMITTANCE a HELD, e a TRANSFERRED arriva solo con un trasferimento
-- Stripe, spento per i contanti. Nessuna rotta, funzione o tasto registrava
-- «bonifico a mano fatto»: il negozio leggeva «0,00 € già versati» e una cifra
-- «in attesa» che cresceva ogni settimana; Nicola rivedeva come «in sospeso» gli
-- ordini già pagati il lunedì prima, e rischiava di pagarli due volte.
--
-- LA CURA.
--   · uno stato nuovo, PAID_MANUALLY, nel vincolo di payout_status;
--   · una colonna col riferimento del bonifico (payout_manual_ref);
--   · una funzione riservata agli amministratori che porta a PAID_MANUALLY gli
--     ordini in contanti HELD e consegnati di UN negozio, con data e riferimento.
-- Il giro dei bonifici Stripe prende solo HELD / PENDING_SELLER_ONBOARDING:
-- PAID_MANUALLY ne resta fuori da solo, e non si paga due volte.
--
-- Non applicata: la applica Nicola.
-- =============================================================================

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

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payout_manual_ref text;

COMMENT ON COLUMN public.orders.payout_manual_ref IS
  'Riferimento del bonifico fatto a mano al negozio (contanti, il lunedì). Scritto solo da segna_bonifico_manuale().';

CREATE OR REPLACE FUNCTION public.segna_bonifico_manuale(
  p_seller uuid,
  p_order_ids uuid[],
  p_riferimento text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_segnati integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_riferimento IS NULL OR length(btrim(p_riferimento)) < 3 THEN
    RAISE EXCEPTION 'manca il riferimento del bonifico' USING errcode = '22023';
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);

  -- Solo contanti con la rimessa confermata (HELD), consegnati, di QUEL negozio:
  -- un id di un altro negozio o di una carta non viene toccato.
  UPDATE public.orders
     SET payout_status = 'PAID_MANUALLY',
         payout_at = now(),
         payout_manual_ref = btrim(p_riferimento)
   WHERE id = ANY (p_order_ids)
     AND seller_id = p_seller
     AND payment_method = 'cod'
     AND delivery_status = 'DELIVERED'
     AND payout_status = 'HELD'
     -- Gli stessi cancelli del giro automatico (release-payouts): niente bonifico a mano su un
     -- ordine con una contestazione in banca, un reclamo, un reso aperto o rimborsato per intero.
     AND (dispute_status IS NULL OR dispute_status = 'WON')
     AND (internal_dispute_status IS NULL OR internal_dispute_status = 'RESOLVED')
     AND coalesce(payment_status, '') <> 'REFUNDED'
     AND NOT EXISTS (SELECT 1 FROM public.returns r
                      WHERE r.order_id = orders.id AND r.status IN ('REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'))
     AND NOT EXISTS (SELECT 1 FROM public.disputes d
                      WHERE d.order_id = orders.id AND d.status IN ('open', 'under_review'));
  GET DIAGNOSTICS v_segnati = ROW_COUNT;

  RETURN v_segnati;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], text) TO authenticated;

COMMENT ON FUNCTION public.segna_bonifico_manuale(uuid, uuid[], text) IS
  'R11-004: l''amministratore segna come pagati a mano (PAID_MANUALLY) gli ordini in contanti HELD e consegnati di un negozio.';

NOTIFY pgrst, 'reload schema';
