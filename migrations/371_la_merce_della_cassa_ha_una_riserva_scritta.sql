-- ═══════════════════════════════════════════════════════════════════════════
-- 371 — LA MERCE DELLA CASSA IN CONTANTI HA UNA RISERVA SCRITTA
-- 13/11/2026 · R13-002
-- ═══════════════════════════════════════════════════════════════════════════
--
-- COSA SI ROMPE OGGI
-- La rotta dei contanti (app/api/orders/cod/route.ts) scala la merce
-- (`reserve_stock`) e il credito MyCity (`wallet_debit`) PRIMA di scrivere
-- l'ordine, e gli articoli dopo. Cosa ha preso lo sa solo la memoria della
-- funzione. Se la funzione muore in mezzo (tempo scaduto, crash, rete caduta
-- dopo il salvataggio) nessuno sa piu' che quella merce e quel credito sono
-- stati presi:
--   · morta prima dell'ordine: merce scalata e credito tolto, nessun ordine;
--   · morta fra l'ordine e gli articoli: un ordine senza articoli, e
--     l'annullo (`restore_stock_for_order`) rimette solo gli articoli, cioe'
--     niente. La merce resta fuori dalla vendita per sempre.
-- La cassa oggi si ferma e avvisa, ma la correzione e' a mano.
--
-- COSA FA QUESTA MIGRAZIONE
-- ① `interno.riserve_della_cassa`: una riga per negozio del carrello, scritta
--   NELLA STESSA TRANSAZIONE in cui `reserve_stock` scala la merce. C'e' la
--   riga se e solo se la merce e' stata presa: non puo' esistere una riga per
--   merce mai scalata (sarebbe un pezzo fantasma rimesso in vendita) ne' merce
--   scalata senza riga. Dentro: l'identificativo dell'ordine deciso PRIMA di
--   scriverlo, la merce, e il riferimento della spesa di credito (chi ha speso
--   e quanto lo dice il diario del credito, `wallet_ledger`). Nessun dato
--   della persona: chi ha comprato lo dicono l'ordine e il diario.
--   Sta in uno schema suo, `interno`, che PostgREST non espone: nessun client
--   la raggiunge, la toccano solo le funzioni qui sotto. Per questo non entra
--   nei tipi generati (lib/database.types.ts), che descrivono le tabelle che
--   il codice legge con `.from()`.
-- ② `reserve_stock` e `restore_stock` prendono un argomento in piu',
--   facoltativo: con lui la prima scrive la riga, la seconda la chiude e
--   rimette la merce in un colpo solo (una volta sola, anche se chiamata due
--   volte). Senza, fanno esattamente quello che facevano: la rotta della
--   carta, i giri e il webhook non cambiano.
-- ③ `chiudi_riserve_della_cassa`: a ordine finito la merce e' degli articoli,
--   la riga si chiude («ordine»). Solo se l'ordine ha davvero gli articoli.
-- ④ `libera_riserve_della_cassa`: chi viene dopo. Prende le righe rimaste
--   aperte da piu' di 15 minuti — oltre la vita massima di una funzione, quindi
--   chi le ha scritte e' morto di sicuro — e guarda la verita':
--     · l'ordine non c'e' (o e' di un altro invio della stessa chiave, che ha
--       chiuso la sua riga) → rimette la merce e il credito, «liberata»;
--     · l'ordine c'e' con gli articoli → la merce e' sua, «ordine»;
--     · l'ordine c'e' senza articoli → rimette la merce, «a_meta». Il credito
--       NO: e' scritto sull'ordine (`wallet_applied_cents`) e lo restituisce
--       l'annullo dell'ordine, come per ogni altro ordine;
--     · due righe aperte sullo stesso ordine → non si sa di chi e' la merce:
--       non si tocca niente e lo si conta («incerte»), per un controllo.
--   La chiama la rotta dei contanti prima di leggere le disponibilita' dei
--   prodotti del carrello (solo le righe con quei prodotti). Chiamata senza
--   argomenti le guarda tutte: e' il lavoro di un giro a orario, che questa
--   migrazione non aggancia (R13-002 dice dove).
-- ⑤ `restore_stock_for_order`: l'annullo di un ordine SENZA articoli rimette
--   la merce della sua riserva scritta. E' la strada che il giro degli ordini
--   fermi e l'amministratore percorrono gia' sull'ordine rimasto a meta'.
--
-- Il credito torna con `wallet_credit(…, 'order_cod_refund', <riferimento>)`:
-- la stessa coppia motivo+riferimento degli storni della rotta, e il diario
-- (migrazione 143) ne tiene una riga sola. Se la rotta l'ha gia' restituito,
-- qui non torna una seconda volta.
--
-- PRIMA DELLA MIGRAZIONE il codice regge: chiama `reserve_stock` con la riga,
-- e se il database risponde «firma sconosciuta» (PGRST202) riprova senza,
-- come oggi.
--
-- RISCHIO / REVERSIBILITA'
-- Nessun dato esistente si tocca. Le due funzioni vecchie si tolgono e si
-- ricreano con un argomento facoltativo in piu' (in Postgres una firma diversa
-- non si sostituisce: senza il DROP nascerebbero due funzioni con lo stesso
-- nome e ogni chiamata sarebbe ambigua). Il corpo, oltre al pezzo nuovo, e'
-- quello della 161. Il ritorno indietro sta in fondo al file.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① La riserva scritta, in uno schema che nessun client vede.
CREATE SCHEMA IF NOT EXISTS interno;
REVOKE ALL ON SCHEMA interno FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS interno.riserve_della_cassa (
  id           uuid PRIMARY KEY,
  ordine_id    uuid NOT NULL,
  merce        jsonb NOT NULL,
  rif_credito  text,
  stato        text NOT NULL DEFAULT 'aperta'
               CHECK (stato IN ('aperta', 'ordine', 'rimessa', 'liberata', 'a_meta')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  chiusa_il    timestamptz
);

COMMENT ON TABLE interno.riserve_della_cassa IS
  'La merce scalata dalla cassa in contanti per un ordine, scritta insieme alla riserva (reserve_stock): se la funzione muore, chi viene dopo sa cosa rimettere (R13-002, migrazione 371).';

CREATE INDEX IF NOT EXISTS riserve_della_cassa_aperte_idx
  ON interno.riserve_della_cassa (created_at) WHERE stato = 'aperta';
CREATE INDEX IF NOT EXISTS riserve_della_cassa_ordine_idx
  ON interno.riserve_della_cassa (ordine_id);

ALTER TABLE interno.riserve_della_cassa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON interno.riserve_della_cassa FROM PUBLIC, anon, authenticated;
-- Nessuna policy: la scrivono e la leggono solo le funzioni qui sotto.

-- ② La riserva della merce scrive la sua riga, nella stessa transazione.
DROP FUNCTION IF EXISTS public.reserve_stock(jsonb);
CREATE OR REPLACE FUNCTION public.reserve_stock(p_items jsonb, p_riserva jsonb DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE it jsonb; v_pid uuid; v_vid uuid; v_qty int; v_updated int;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid := (it->>'product_id')::uuid;
    v_vid := NULLIF(it->>'variant_id', '')::uuid;
    v_qty := (it->>'qty')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
    IF v_vid IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock - v_qty
        WHERE id = v_vid AND product_id = v_pid AND stock >= v_qty;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        RAISE EXCEPTION 'OUT_OF_STOCK:%', v_vid USING ERRCODE = '23514';
      END IF;
    ELSE
      IF v_pid IS NULL THEN CONTINUE; END IF;
      UPDATE public.products
        SET stock = stock - v_qty
        WHERE id = v_pid AND (stock IS NULL OR stock >= v_qty);
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        RAISE EXCEPTION 'OUT_OF_STOCK:%', v_pid USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  -- 371 — La riga nasce solo se tutta la merce e' stata presa: un OUT_OF_STOCK qui sopra annulla
  -- tutto, riga compresa. E se la riga non si scrive (dati mancanti), la merce non si scala.
  IF p_riserva IS NOT NULL THEN
    INSERT INTO interno.riserve_della_cassa (id, ordine_id, merce, rif_credito)
    VALUES ((p_riserva->>'id')::uuid, (p_riserva->>'ordine_id')::uuid, p_items, NULLIF(p_riserva->>'rif_credito', ''));
  END IF;
END; $function$;

-- La merce torna: con la riga, una volta sola e insieme alla chiusura della riga.
DROP FUNCTION IF EXISTS public.restore_stock(jsonb);
CREATE OR REPLACE FUNCTION public.restore_stock(p_items jsonb, p_riserva uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE it jsonb; v_vid uuid; v_merce jsonb := p_items;
BEGIN
  -- 371 — Con la riga si rimette la merce che la riga dice, e solo se la riga e' ancora aperta:
  -- chi arriva secondo (la rotta e la pulizia insieme) la trova chiusa e non somma niente.
  IF p_riserva IS NOT NULL THEN
    UPDATE interno.riserve_della_cassa
       SET stato = 'rimessa', chiusa_il = now()
     WHERE id = p_riserva AND stato = 'aperta'
     RETURNING merce INTO v_merce;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(v_merce)
  LOOP
    v_vid := NULLIF(it->>'variant_id', '')::uuid;
    IF v_vid IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock + (it->>'qty')::int
        WHERE id = v_vid;
    ELSE
      UPDATE public.products
        SET stock = stock + (it->>'qty')::int
        WHERE id = (it->>'product_id')::uuid AND stock IS NOT NULL;
    END IF;
  END LOOP;
END; $function$;

-- ③ A ordine finito la merce e' degli articoli: la riga si chiude. Solo se gli articoli ci sono,
-- perche' «ordine» e' la prova che la pulizia usa per dire di chi e' un ordine.
CREATE OR REPLACE FUNCTION public.chiudi_riserve_della_cassa(p_riserve uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  UPDATE interno.riserve_della_cassa r
     SET stato = 'ordine', chiusa_il = now()
   WHERE r.id = ANY(p_riserve)
     AND r.stato = 'aperta'
     AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = r.ordine_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;

-- ④ Chi viene dopo.
CREATE OR REPLACE FUNCTION public.libera_riserve_della_cassa(p_prodotti uuid[] DEFAULT NULL, p_minuti integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Mai meno di 15 minuti: sotto, la funzione che ha scritto la riga potrebbe essere ancora viva e
  -- stare per scrivere il suo ordine. Rimettere la sua merce adesso venderebbe due volte lo stesso pezzo.
  v_minuti int := GREATEST(COALESCE(p_minuti, 15), 15);
  r interno.riserve_della_cassa%ROWTYPE;
  v_ordine boolean;
  v_altra_chiusa boolean;
  v_altra_aperta boolean;
  v_cliente uuid;
  v_credito int;
  v_liberate int := 0; v_a_meta int := 0; v_chiuse int := 0; v_incerte int := 0; v_errori int := 0;
BEGIN
  FOR r IN
    SELECT * FROM interno.riserve_della_cassa
     WHERE stato = 'aperta'
       AND created_at < now() - make_interval(mins => v_minuti)
       -- Con un elenco di prodotti, solo le righe che ne tengono almeno uno (la rotta, prima di leggerli).
       AND (p_prodotti IS NULL OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(merce) e
              WHERE NULLIF(e->>'product_id', '')::uuid = ANY (p_prodotti)))
     ORDER BY created_at
     LIMIT 200
     FOR UPDATE SKIP LOCKED
  LOOP
    -- Una riga alla volta, ognuna per conto suo: una che non si sistema non ferma le altre.
    BEGIN
      v_ordine := EXISTS (SELECT 1 FROM public.orders o WHERE o.id = r.ordine_id);
      -- Lo stesso identificativo puo' averlo un secondo invio della stessa chiave (la chiave
      -- abbandonata si riprende dopo un minuto): l'ordine e' di chi ha chiuso la sua riga.
      v_altra_chiusa := EXISTS (SELECT 1 FROM interno.riserve_della_cassa a
                                 WHERE a.ordine_id = r.ordine_id AND a.id <> r.id AND a.stato = 'ordine');
      v_altra_aperta := EXISTS (SELECT 1 FROM interno.riserve_della_cassa a
                                 WHERE a.ordine_id = r.ordine_id AND a.id <> r.id AND a.stato = 'aperta');

      IF NOT v_ordine OR v_altra_chiusa THEN
        -- Nessun ordine e' nato da questa merce: torna in vendita, e il credito torna al cliente.
        PERFORM public.restore_stock(r.merce);
        -- Chi ha speso e quanto lo dice il diario del credito, alla riga di quella spesa.
        v_cliente := NULL; v_credito := NULL;
        IF r.rif_credito IS NOT NULL THEN
          SELECT w.user_id, -w.delta_cents INTO v_cliente, v_credito
            FROM public.wallet_ledger w
           WHERE w.reason = 'order_cod' AND w.ref = r.rif_credito AND w.delta_cents < 0
           LIMIT 1;
          IF v_cliente IS NOT NULL AND COALESCE(v_credito, 0) > 0 THEN
            PERFORM public.wallet_credit(v_cliente, v_credito, 'order_cod_refund', r.rif_credito);
          END IF;
        END IF;
        UPDATE interno.riserve_della_cassa SET stato = 'liberata', chiusa_il = now() WHERE id = r.id;
        v_liberate := v_liberate + 1;
      ELSIF v_altra_aperta THEN
        -- Due righe aperte sullo stesso ordine: una sola ha scritto l'ordine, e non si sa quale.
        v_incerte := v_incerte + 1;
      ELSIF EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = r.ordine_id) THEN
        UPDATE interno.riserve_della_cassa SET stato = 'ordine', chiusa_il = now() WHERE id = r.id;
        v_chiuse := v_chiuse + 1;
      ELSE
        -- L'ordine e' rimasto a meta': nessun articolo la ricordera' mai, la merce torna adesso.
        -- Il credito resta scritto sull'ordine e torna col suo annullo.
        PERFORM public.restore_stock(r.merce);
        UPDATE interno.riserve_della_cassa SET stato = 'a_meta', chiusa_il = now() WHERE id = r.id;
        v_a_meta := v_a_meta + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errori := v_errori + 1;
      RAISE WARNING 'riserva della cassa % non sistemata: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('liberate', v_liberate, 'a_meta', v_a_meta, 'chiuse', v_chiuse,
                            'incerte', v_incerte, 'errori', v_errori);
END; $function$;

-- ⑤ L'annullo di un ordine senza articoli rimette la merce della sua riserva. Il resto e' la 160.
CREATE OR REPLACE FUNCTION public.restore_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_merce jsonb;
BEGIN
  PERFORM set_config('mycity.allow_order_write', '1', true);

  UPDATE public.orders
     SET stock_restored_at = now()
   WHERE id = p_order_id
     AND stock_restored_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.product_variants v
    SET stock = v.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.variant_id = v.id;

  UPDATE public.products p
    SET stock = p.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.product_id = p.id
    AND oi.variant_id IS NULL
    AND p.stock IS NOT NULL;

  -- 371 — Senza articoli, la merce di questo ordine e' nella sua riserva scritta. Solo se la riga
  -- aperta e' una: con due non si sa quale merce e' la sua, e decide la pulizia (le conta «incerte»).
  IF NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = p_order_id)
     AND (SELECT count(*) FROM interno.riserve_della_cassa r
           WHERE r.ordine_id = p_order_id AND r.stato = 'aperta') = 1 THEN
    UPDATE interno.riserve_della_cassa
       SET stato = 'a_meta', chiusa_il = now()
     WHERE ordine_id = p_order_id AND stato = 'aperta'
     RETURNING merce INTO v_merce;
    PERFORM public.restore_stock(v_merce);
  END IF;
END; $$;

-- I permessi: nessun client le esegue, solo il server.
REVOKE ALL ON FUNCTION public.reserve_stock(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_stock(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chiudi_riserve_della_cassa(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.libera_riserve_della_cassa(uuid[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_stock_for_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stock(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_stock(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chiudi_riserve_della_cassa(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.libera_riserve_della_cassa(uuid[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_stock_for_order(uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- RITORNO INDIETRO (rollback) — prima si rimette il codice che chiama le firme
-- vecchie, poi si incolla questo. Le righe ancora aperte vanno guardate prima:
-- e' merce scalata che nessuno rimettera' piu'.
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.libera_riserve_della_cassa(uuid[], integer);
-- DROP FUNCTION IF EXISTS public.chiudi_riserve_della_cassa(uuid[]);
-- DROP FUNCTION IF EXISTS public.reserve_stock(jsonb, jsonb);
-- DROP FUNCTION IF EXISTS public.restore_stock(jsonb, uuid);
-- -- poi: reserve_stock(jsonb) e restore_stock(jsonb) col testo della 161, e
-- --       restore_stock_for_order(uuid) col testo della 160, con gli stessi permessi;
-- DROP TABLE IF EXISTS interno.riserve_della_cassa;
-- DROP SCHEMA IF EXISTS interno;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
