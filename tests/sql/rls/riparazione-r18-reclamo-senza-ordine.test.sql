-- =============================================================================
-- R18-020 · Un reclamo non resta legato a un ordine che non esiste
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   tests/sql/harness/run.sh   mycity_test
--
-- Il difetto: disputes.order_id (027:330) era `uuid NOT NULL` senza chiave
-- esterna verso orders; lo stesso loyalty_transactions.order_id e
-- zone_code_uses.order_id. Un reclamo si scriveva su un ordine inventato, e
-- cancellando un ordine il suo reclamo restava nel pannello senza ordine.
--
-- Non cerca i nomi delle chiavi: prova a scrivere righe su un ordine che non
-- c'è e a cancellare ordini che hanno righe legate, e guarda cosa resta.
-- Senza la 424 è rossa. Tutto in transazione con ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, verde boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1820000-0000-0000-0000-00000000000a', 'fornaio-r18r@test.it', '{"role":"seller"}'),
  ('e1820000-0000-0000-0000-00000000000b', 'cliente-r18r@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Pane R18r'
 WHERE id = 'e1820000-0000-0000-0000-00000000000a';

-- Tre ordini veri: uno resta, due si provano a cancellare.
INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents,
  payment_method, payment_status, delivery_status,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
)
SELECT v.id::uuid,
       'e1820000-0000-0000-0000-00000000000b', 'e1820000-0000-0000-0000-00000000000a',
       20.00, 2000, 'card', 'PAID', 'DELIVERED',
       'Maria Rossi', '3331234567', 'Via Verdi 10', 'Piacenza', '29121'
FROM (VALUES ('e1820000-2222-0000-0000-000000000001'),
             ('e1820000-2222-0000-0000-000000000002'),
             ('e1820000-2222-0000-0000-000000000003')) AS v(id);

INSERT INTO public.zone_codes (code, zone_name, zip, discount_percent)
VALUES ('R18R-ZONA', 'Centro', '29121', 10);

-- Aiuto: esegue un comando e torna 'ok' o il codice dell'errore.
CREATE OR REPLACE FUNCTION pg_temp.esito(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

-- ── ① Un reclamo su un ordine inventato non si scrive ────────────────────
DO $$
DECLARE e text;
BEGIN
  e := pg_temp.esito($q$
    INSERT INTO public.disputes (order_id, opener_id, reason, description)
    VALUES ('11111111-0000-0000-0000-000000000000', 'e1820000-0000-0000-0000-00000000000b', 'x', 'y')
  $q$);
  INSERT INTO esiti VALUES ('1 un reclamo su un ordine che non esiste non si scrive',
    e = '23503', CASE WHEN e = 'ok' THEN 'PASSATO: reclamo scritto su un ordine inventato' ELSE 'esito ' || e END);
END $$;

-- ── ② Un reclamo su un ordine vero si scrive ─────────────────────────────
DO $$
DECLARE e text;
BEGIN
  e := pg_temp.esito($q$
    INSERT INTO public.disputes (id, order_id, opener_id, reason, description)
    VALUES ('e1820000-3333-0000-0000-000000000002', 'e1820000-2222-0000-0000-000000000002',
            'e1820000-0000-0000-0000-00000000000b', 'altro', 'Il pane era raffermo')
  $q$);
  INSERT INTO esiti VALUES ('2 un reclamo su un ordine vero si scrive', e = 'ok', 'esito ' || e);
END $$;

-- ── ③ L'ordine col reclamo non si cancella, e il reclamo resta legato ────
DO $$
DECLARE e text; legato boolean;
BEGIN
  e := pg_temp.esito($q$
    DELETE FROM public.orders WHERE id = 'e1820000-2222-0000-0000-000000000002'
  $q$);
  SELECT EXISTS (SELECT 1 FROM public.disputes d JOIN public.orders o ON o.id = d.order_id
                  WHERE d.id = 'e1820000-3333-0000-0000-000000000002') INTO legato;
  INSERT INTO esiti VALUES ('3 un ordine con un reclamo non si cancella e il reclamo resta col suo ordine',
    e <> 'ok' AND legato,
    format('cancellazione: %s · reclamo ancora col suo ordine: %s', e, legato));
END $$;

-- ── ④ Punti e codici di zona su un ordine inventato non si scrivono ──────
DO $$
DECLARE e1 text; e2 text;
BEGIN
  e1 := pg_temp.esito($q$
    INSERT INTO public.loyalty_transactions (user_id, delta, reason, order_id)
    VALUES ('e1820000-0000-0000-0000-00000000000b', 10, 'order_delivered', '11111111-0000-0000-0000-000000000000')
  $q$);
  e2 := pg_temp.esito($q$
    INSERT INTO public.zone_code_uses (code, user_id, order_id)
    VALUES ('R18R-ZONA', 'e1820000-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000000')
  $q$);
  INSERT INTO esiti VALUES ('4 punti e codici di zona su un ordine che non esiste non si scrivono',
    e1 = '23503' AND e2 = '23503', format('punti: %s · codice di zona: %s', e1, e2));
END $$;

-- ── ⑤ Cancellato l'ordine, punti e codici di zona restano senza puntare al vuoto
INSERT INTO public.loyalty_transactions (user_id, delta, reason, order_id)
VALUES ('e1820000-0000-0000-0000-00000000000b', 10, 'r18r-prova', 'e1820000-2222-0000-0000-000000000003');
INSERT INTO public.zone_code_uses (code, user_id, order_id)
VALUES ('R18R-ZONA', 'e1820000-0000-0000-0000-00000000000b', 'e1820000-2222-0000-0000-000000000003');
DO $$
DECLARE e text; orfani int; righe int;
BEGIN
  e := pg_temp.esito($q$
    DELETE FROM public.orders WHERE id = 'e1820000-2222-0000-0000-000000000003'
  $q$);
  SELECT count(*) INTO righe FROM (
    SELECT order_id FROM public.loyalty_transactions WHERE reason = 'r18r-prova'
    UNION ALL
    SELECT order_id FROM public.zone_code_uses WHERE code = 'R18R-ZONA') x;
  SELECT count(*) INTO orfani FROM (
    SELECT order_id FROM public.loyalty_transactions WHERE reason = 'r18r-prova'
    UNION ALL
    SELECT order_id FROM public.zone_code_uses WHERE code = 'R18R-ZONA') x
   WHERE x.order_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = x.order_id);
  INSERT INTO esiti VALUES ('5 cancellato l''ordine, punti e codici di zona restano ma non puntano a un ordine che non c''è',
    e = 'ok' AND righe = 2 AND orfani = 0,
    format('cancellazione: %s · righe rimaste: %s (attese 2) · orfane: %s (attese 0)', e, righe, orfani));
END $$;

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  ' ORDER BY e.nome), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.verde IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION E'R18-020: % controllo/i rosso/i sui legami con l''ordine:\n  %', rossi, elenco;
  END IF;
  RAISE INFO 'R18-020: reclami, punti e codici di zona restano legati a ordini veri (% controlli verdi)',
    (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
