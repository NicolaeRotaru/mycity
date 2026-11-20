-- =============================================================================
-- 620 — I SOLDI FRA GLI ORDINI DEL CARRELLO PASSANO IN UNA TRANSAZIONE (R05-006)
-- =============================================================================
--
-- NON APPLICATA. La applica Nicola.
--
-- ── Cosa c'e' che non va, in parole semplici ─────────────────────────────────
-- Quando un negozio di un carrello se ne va prima della consegna (rifiuto del
-- negozio, annullo, ordine scaduto), lib/ordini/annulla.ts
-- (`ricalcolaLaConsegnaDelGiro`) rifa' la consegna degli ordini rimasti: la
-- consegna e il compenso del fattorino passano da un ordine all'altro, e con
-- loro il totale. Lo faceva con una scrittura per riga (il segno sull'ordine
-- che se ne va, poi il suo conto, poi un ordine rimasto alla volta) e, se una
-- cadeva, con una compensazione scritta a mano che riscriveva le righe gia'
-- fatte. Se cadeva anche la compensazione (il database giu', una connessione
-- persa) o il processo si fermava fra due scritture, il carrello restava a
-- meta'. Pane 15 € + frutta 12 €, il forno rifiuta: la sua consegna scende da
-- 3 € a 1 €, ma la frutta resta a 1 €. Due euro spariti dal carrello, e la
-- carta rendeva 18 € su un ordine che ne diceva 16.
--
-- ── Cosa fa ──────────────────────────────────────────────────────────────────
-- `sposta_la_consegna_nel_carrello(p_righe)` fa tutte le scritture del giro in
-- una transazione sola: o tutte o nessuna. Ogni elemento di p_righe e'
-- {id, da, a?}:
--   · da: la riga come l'ha letta chi ha fatto il conto (consegna, fattorino,
--         stato, rimborsato, contanti incassati). Tutte le chiavi ci sono;
--   · a:  quello che va scritto (consegna, fattorino, totale, lordo). Senza
--         `a` la riga si controlla soltanto: il conto l'ha letta, quindi non
--         deve essere cambiata nel frattempo.
-- Blocca le righe (FOR UPDATE, in ordine di id: due annulli dello stesso
-- carrello non si incastrano), controlla che ognuna sia ancora com'era letta e
-- solo allora scrive. Torna true se ha scritto tutto; false se una riga era
-- cambiata, e allora non scrive niente: chi chiama rilegge e rifa' il conto.
-- Un errore (un paletto sui soldi, righe malformate) disfa tutto.
--
-- Il conto resta nel codice (lib/ordini/prezzi.ts, `consegnaDopoLAnnullo`):
-- qui non si calcola niente e non cambia nessuna cifra, si scrive tutto
-- insieme. La stessa funzione rimette il carrello com'era quando il rimborso
-- non parte (le stesse righe, all'indietro).
--
-- Solo il server (chiave service_role), che e' chi scrive gia' oggi queste
-- righe. SECURITY INVOKER: valgono i permessi di chi chiama e il guardiano
-- degli ordini (179), esattamente come per le scritture di oggi. Gli ordini
-- devono essere di un cliente solo, come ogni carrello.
--
-- Il codice regge anche prima di questa migrazione: se la funzione non c'e'
-- (PGRST202) fa le scritture una per riga, come prima.
--
-- ── Che rischio ha ───────────────────────────────────────────────────────────
-- Nessuno sui dati: crea una funzione nuova, non tocca righe. Riapplicabile.
-- REVERSIBILE: DROP FUNCTION public.sposta_la_consegna_nel_carrello(jsonb);
-- il codice torna da solo alle scritture una per riga.
-- La prova: tests/sql/rls/riparazione-r05-soldi-in-transazione.test.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sposta_la_consegna_nel_carrello(p_righe jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_ids    uuid[];
  v_riga   jsonb;
  v_da     jsonb;
  v_a      jsonb;
  v_ordine public.orders%ROWTYPE;
BEGIN
  IF p_righe IS NULL OR jsonb_typeof(p_righe) <> 'array' OR jsonb_array_length(p_righe) = 0 THEN
    RAISE EXCEPTION 'sposta_la_consegna_nel_carrello: nessuna riga' USING ERRCODE = '22023';
  END IF;

  FOR v_riga IN SELECT * FROM jsonb_array_elements(p_righe) LOOP
    IF jsonb_typeof(v_riga) <> 'object'
       OR NOT coalesce(v_riga->'da' ?& ARRAY['delivery_fee_cents', 'rider_fee_cents', 'delivery_status',
                                             'refunded_amount_cents', 'incassato'], false)
       OR (v_riga ? 'a' AND NOT coalesce(v_riga->'a' ?& ARRAY['delivery_fee_cents', 'rider_fee_cents',
                                                              'total_price', 'gross_total_cents'], false)) THEN
      RAISE EXCEPTION 'sposta_la_consegna_nel_carrello: riga malformata' USING ERRCODE = '22023', DETAIL = v_riga::text;
    END IF;
  END LOOP;

  SELECT array_agg((e->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(p_righe) AS e;
  IF array_position(v_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'sposta_la_consegna_nel_carrello: righe senza id o ripetute' USING ERRCODE = '22023';
  END IF;

  -- Le righe si bloccano tutte, sempre nello stesso ordine: un secondo annullo dello stesso
  -- carrello aspetta qui, poi trova le righe cambiate e non scrive niente.
  PERFORM 1 FROM public.orders WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;

  IF (SELECT count(DISTINCT user_id) FROM public.orders WHERE id = ANY (v_ids)) > 1 THEN
    RAISE EXCEPTION 'sposta_la_consegna_nel_carrello: ordini di clienti diversi' USING ERRCODE = '22023';
  END IF;

  -- Ogni riga deve essere ancora come l'ha letta il conto: altrimenti non si scrive niente.
  FOR v_riga IN SELECT * FROM jsonb_array_elements(p_righe) LOOP
    v_da := v_riga->'da';
    SELECT * INTO v_ordine FROM public.orders WHERE id = (v_riga->>'id')::uuid;
    IF NOT FOUND
       OR v_ordine.delivery_fee_cents    IS DISTINCT FROM (v_da->>'delivery_fee_cents')::integer
       OR v_ordine.rider_fee_cents       IS DISTINCT FROM (v_da->>'rider_fee_cents')::integer
       OR v_ordine.delivery_status       IS DISTINCT FROM (v_da->>'delivery_status')
       OR v_ordine.refunded_amount_cents IS DISTINCT FROM (v_da->>'refunded_amount_cents')::integer
       OR (v_ordine.cash_confirmed_at IS NOT NULL) IS DISTINCT FROM (v_da->>'incassato')::boolean THEN
      RETURN false;
    END IF;
  END LOOP;

  -- Tutte le scritture: dentro la stessa transazione, un errore su una le disfa tutte.
  FOR v_riga IN SELECT * FROM jsonb_array_elements(p_righe) LOOP
    CONTINUE WHEN NOT v_riga ? 'a';
    v_a := v_riga->'a';
    UPDATE public.orders
       SET delivery_fee_cents = (v_a->>'delivery_fee_cents')::integer,
           rider_fee_cents    = (v_a->>'rider_fee_cents')::integer,
           total_price        = (v_a->>'total_price')::numeric,
           gross_total_cents  = (v_a->>'gross_total_cents')::integer
     WHERE id = (v_riga->>'id')::uuid;
  END LOOP;

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.sposta_la_consegna_nel_carrello(jsonb) IS
  'Scrive consegna, fattorino, totale e lordo degli ordini di un carrello in una transazione sola, solo se ogni riga e'' ancora come letta (false altrimenti, niente scritto). Il conto lo fa lib/ordini/annulla.ts. Solo il server (620).';

REVOKE ALL ON FUNCTION public.sposta_la_consegna_nel_carrello(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sposta_la_consegna_nel_carrello(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
