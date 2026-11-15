-- =============================================================================
-- 501 — LA RIMESSA CONFERMA SOLO GLI ORDINI CHE L'AMMINISTRATORE HA VISTO
-- =============================================================================
--
-- NON APPLICATA. La applica Nicola.
--
-- ── Cosa c'e' che non va, in parole semplici ─────────────────────────────────
-- «Conferma rimessa» (pagina Rimesse contanti) chiamava
-- `confirm_cod_remittance(fattorino, giorno)`: la funzione porta a HELD — cioe'
-- rende pagabile il negozio — TUTTI gli ordini in contanti di quel fattorino in
-- quel giorno con l'incasso registrato. Anche quelli arrivati DOPO che
-- l'amministratore ha aperto la pagina: lui ha contato i contanti di 3 ordini,
-- il clic ne sblocca 5, e i 2 in piu' vengono pagati ai negozi senza che
-- nessuno abbia visto quei contanti.
--
-- ── Cosa fa ──────────────────────────────────────────────────────────────────
-- Aggiunge una seconda forma della stessa funzione, con l'elenco degli ordini
-- che la pagina mostrava (`p_order_ids`). Rilascia solo quelli; gli altri dello
-- stesso giorno restano in attesa e compaiono alla prossima lettura della pagina.
-- Il conto dei «saltati senza incasso» guarda lo stesso elenco.
--
-- La forma vecchia a due argomenti resta com'e' (migrazione 127): la rotta la
-- usa solo se questa non e' ancora applicata, cosi' i negozi non restano senza
-- pagamento nell'attesa.
--
-- ── Che rischio ha ───────────────────────────────────────────────────────────
-- Nessuno sui dati: crea una funzione nuova, non tocca righe.
-- La prova: tests/sql/rls/riparazione-r26-la-rimessa-conferma-solo-gli-ordini-visti.test.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_cod_remittance(p_rider uuid, p_date date, p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_released integer; v_saltati integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  PERFORM set_config('mycity.allow_order_write', '1', true);

  SELECT count(*) INTO v_saltati
    FROM public.orders
   WHERE id = ANY(coalesce(p_order_ids, '{}'::uuid[]))
     AND rider_id = p_rider
     AND payment_method = 'cod'
     AND delivery_status = 'DELIVERED'
     AND payout_status = 'AWAITING_REMITTANCE'
     AND (delivered_at AT TIME ZONE 'Europe/Rome')::date = p_date
     AND cash_confirmed_at IS NULL;

  UPDATE public.orders
    SET payout_status = 'HELD'
  WHERE id = ANY(coalesce(p_order_ids, '{}'::uuid[]))
    AND rider_id = p_rider
    AND payment_method = 'cod'
    AND delivery_status = 'DELIVERED'
    AND payout_status = 'AWAITING_REMITTANCE'
    AND cash_confirmed_at IS NOT NULL
    AND (delivered_at AT TIME ZONE 'Europe/Rome')::date = p_date;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  INSERT INTO public.cod_reconciliations (rider_id, for_date, remitted_at, remitted_by)
  VALUES (p_rider, p_date, now(), (SELECT auth.uid()))
  ON CONFLICT (rider_id, for_date)
  DO UPDATE SET remitted_at = now(), remitted_by = (SELECT auth.uid());

  RETURN jsonb_build_object('rilasciati', v_released, 'saltati_senza_incasso', v_saltati);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_cod_remittance(uuid, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_cod_remittance(uuid, date, uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
