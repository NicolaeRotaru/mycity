-- =============================================================================
-- 300 — Un solo ordine senza stato non spegne la Panoramica (R06-013, 12/11/2026)
-- =============================================================================
-- IL DIFETTO. admin_kpi (migrazione 215) raggruppa con jsonb_object_agg(role, n)
-- e jsonb_object_agg(delivery_status, n). Le due colonne possono essere vuote
-- (001_create_tables.sql, nessun NOT NULL dopo). Con una chiave NULL Postgres
-- risponde «field name must not be null», cade l'intera funzione e la pagina
-- mostra «Non sono riuscito a leggere i numeri».
--
-- LA CORREZIONE. Le chiavi vuote diventano 'senza_ruolo' e 'SENZA_STATO'. Tutto
-- il resto della funzione è identico alla 215.
--
-- RITORNO INDIETRO (down): rieseguire il blocco CREATE OR REPLACE FUNCTION
-- public.admin_kpi della migrazione 215. Nessun dato viene toccato.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_kpi()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  risultato jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'riservato allo staff' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'utenti', (SELECT jsonb_object_agg(coalesce(role, 'senza_ruolo'), n) FROM (
                 SELECT role, count(*) AS n FROM public.profiles GROUP BY role) x),
    'utenti_totali', (SELECT count(*) FROM public.profiles),
    'ordini_totali', (SELECT count(*) FROM public.orders),
    'ordini_per_stato', (SELECT jsonb_object_agg(coalesce(delivery_status, 'SENZA_STATO'), n) FROM (
                 SELECT delivery_status, count(*) AS n FROM public.orders GROUP BY delivery_status) y),
    -- Incassato sugli ordini consegnati, in centesimi: quello che il cliente ha
    -- pagato (credito MyCity compreso) meno quello che gli è tornato indietro.
    'incassato_cents', (SELECT coalesce(sum(greatest(0,
                            round(coalesce(total_price, 0) * 100)
                            + greatest(0, coalesce(wallet_applied_cents, 0))
                            - coalesce(refunded_amount_cents, 0))), 0)::bigint
                          FROM public.orders WHERE delivery_status = 'DELIVERED'),
    'incassato_7g_cents', (SELECT coalesce(sum(greatest(0,
                            round(coalesce(total_price, 0) * 100)
                            + greatest(0, coalesce(wallet_applied_cents, 0))
                            - coalesce(refunded_amount_cents, 0))), 0)::bigint
                          FROM public.orders
                         WHERE delivery_status = 'DELIVERED'
                           AND created_at >= now() - interval '7 days'),
    'ordini_7g', (SELECT count(*) FROM public.orders WHERE created_at >= now() - interval '7 days'),
    'prodotti_totali', (SELECT count(*) FROM public.products),
    'prodotti_disponibili', (SELECT count(*) FROM public.products WHERE status = 'available'),
    -- La commissione VERA trattenuta, non una stima su un'aliquota scritta a
    -- mano: si somma quella registrata su ogni ordine.
    'commissioni_cents', (SELECT coalesce(sum(application_fee_cents), 0)::bigint
                          FROM public.orders
                         WHERE delivery_status = 'DELIVERED')
  ) INTO risultato;

  RETURN risultato;
END;
$function$;
