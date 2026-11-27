-- ═══════════════════════════════════════════════════════════════════════════
-- 961 — LA MERCE RISERVATA RESTA SCRITTA FINCHE' L'ORDINE NON LA PRENDE
-- 26/11/2026 · riparazione R27, cassa in contanti
-- ═══════════════════════════════════════════════════════════════════════════
--
-- COSA SI ROMPE OGGI
-- La cassa in contanti (app/api/orders/cod/route.ts) scala la merce
-- (`reserve_stock`) e toglie il credito MyCity (`wallet_debit`) PRIMA di
-- scrivere l'ordine, e scrive gli articoli DOPO. Di quella riserva non resta
-- niente fuori dalla memoria della funzione: se la funzione muore in mezzo
-- (tempo scaduto, server riavviato), la merce resta scalata e il credito tolto,
-- e nessuno li rimette. `restore_stock_for_order` rimette solo da `order_items`,
-- che in quel caso non ci sono. Oggi la cassa si ferma e avvisa, ma la merce
-- torna solo a mano.
--
-- COSA FA QUESTA MIGRAZIONE
-- ① `private.riserve_merce_contanti`: una riga per ogni riserva della cassa in
--    contanti, con l'ordine che la prendera', la merce e il riferimento della
--    spesa del credito. Sta nello schema private (come la 910): l'API non la
--    espone, ci passano solo le funzioni qui sotto. La rotta la chiude
--    (`chiudi_riserva_contanti`) appena l'ordine ha i suoi articoli.
-- ② `reserve_stock(p_items, p_riserva)`: scrive la riga e scala la merce nella
--    STESSA transazione. O tutte e due o nessuna: non esiste una riga senza
--    merce scalata, ne' merce scalata senza riga.
-- ③ `restore_stock(p_items, p_riserva)`: toglie la riga e rimette la merce
--    scritta in lei, insieme e una volta sola. Se la riga non c'e' piu' (l'ha
--    gia' liberata il giro) non rimette niente. `p_items` c'e' perche' la
--    chiamata somigli a quella di sempre: si rimette la merce della riga, cioe'
--    quella scalata davvero.
-- ④ `libera_riserve_orfane(p_minuti)`: il giro (lo chiama il lavoro degli
--    ordini fermi). Una riga piu' vecchia di `p_minuti` e' di una funzione
--    morta. Se l'ordine ha i suoi articoli la merce e' dell'ordine (la rimette
--    chi lo annulla, `restore_stock_for_order`): la riga si chiude e basta.
--    Altrimenti la merce torna a scaffale e, se l'ordine non e' mai nato,
--    torna anche il credito tolto, con lo stesso motivo e riferimento dello
--    storno della cassa: il diario lo scrive una volta sola (143), quindi uno
--    storno gia' fatto dalla rotta non si ripete. Se l'ordine c'e' senza
--    articoli il credito e' suo (`wallet_applied_cents`): lo ridà chi lo annulla.
--
-- Le versioni a un parametro di `reserve_stock` e `restore_stock` restano come
-- sono: la carta e gli altri chiamanti non cambiano. Se la rotta gira prima che
-- questa migrazione sia applicata, la chiamata a due parametri non trova la
-- funzione e la rotta riserva come prima (senza la riga).
--
-- RISCHIO / REVERSIBILITA'
-- Nessun dato esistente viene toccato: una tabella nuova e quattro funzioni nuove
-- (due sono versioni a due parametri di nomi che esistono gia'). Il ritorno
-- indietro sta in fondo al file. Prima di toglierla, guardare se la tabella ha
-- righe: sono merce scalata che solo lei sa rimettere.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① La riserva scritta.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.riserve_merce_contanti (
  id          uuid PRIMARY KEY,
  order_id    uuid NOT NULL,
  user_id     uuid NOT NULL,
  items       jsonb NOT NULL,
  wallet_ref  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE private.riserve_merce_contanti IS
  'Merce scalata dalla cassa in contanti per un ordine che non ha ancora i suoi articoli. La rotta la chiude quando gli articoli ci sono; libera_riserve_orfane rimette la merce delle righe rimaste (funzione morta in mezzo).';

CREATE INDEX IF NOT EXISTS riserve_merce_contanti_nate_idx
  ON private.riserve_merce_contanti (created_at);

ALTER TABLE private.riserve_merce_contanti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.riserve_merce_contanti FROM PUBLIC, anon, authenticated;
-- Nessuna policy e nessun permesso diretto: ci passano solo le funzioni qui sotto.

-- ② Riga e merce insieme.
CREATE OR REPLACE FUNCTION public.reserve_stock(p_items jsonb, p_riserva jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO private.riserve_merce_contanti (id, order_id, user_id, items, wallet_ref)
  VALUES (
    (p_riserva->>'id')::uuid,
    (p_riserva->>'order_id')::uuid,
    (p_riserva->>'user_id')::uuid,
    p_items,
    NULLIF(p_riserva->>'wallet_ref', '')
  );
  -- Se la merce non basta, l'eccezione di reserve_stock porta via anche la riga.
  PERFORM public.reserve_stock(p_items);
END; $$;

-- ③ Riga e merce tornano insieme, una volta sola.
CREATE OR REPLACE FUNCTION public.restore_stock(p_items jsonb, p_riserva uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_items jsonb;
BEGIN
  DELETE FROM private.riserve_merce_contanti
   WHERE id = p_riserva
  RETURNING items INTO v_items;
  IF NOT FOUND THEN
    -- Gia' liberata (dal giro, o da una chiamata ripetuta): non si somma niente.
    RETURN;
  END IF;
  PERFORM public.restore_stock(v_items);
END; $$;

-- ④ Gli articoli ci sono: la merce e' dell'ordine, la riga si chiude senza rimettere niente.
CREATE OR REPLACE FUNCTION public.chiudi_riserva_contanti(p_riserva uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM private.riserve_merce_contanti WHERE id = p_riserva;
END; $$;

-- ⑤ Il giro delle riserve rimaste a una funzione morta.
CREATE OR REPLACE FUNCTION public.libera_riserve_orfane(p_minuti int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_tolto int;
  v_liberate int := 0;
BEGIN
  IF p_minuti IS NULL OR p_minuti <= 0 THEN
    RAISE EXCEPTION 'libera_riserve_orfane: minuti non validi' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT id, order_id, user_id, items, wallet_ref
      FROM private.riserve_merce_contanti
     WHERE created_at < now() - make_interval(mins => p_minuti)
     ORDER BY created_at
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  LOOP
    -- Una riga per volta: se una non si libera (un profilo sparito), le altre vanno avanti
    -- e lei resta per il giro dopo.
    BEGIN
      DELETE FROM private.riserve_merce_contanti WHERE id = r.id;

      IF NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = r.order_id) THEN
        PERFORM public.restore_stock(r.items);

        IF r.wallet_ref IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = r.order_id) THEN
          SELECT -l.delta_cents INTO v_tolto
            FROM public.wallet_ledger l
           WHERE l.user_id = r.user_id
             AND l.reason = 'order_cod'
             AND l.ref = r.wallet_ref;
          IF coalesce(v_tolto, 0) > 0 THEN
            PERFORM public.wallet_credit(r.user_id, v_tolto, 'order_cod_refund', r.wallet_ref);
          END IF;
        END IF;

        v_liberate := v_liberate + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'libera_riserve_orfane: riserva % non liberata: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_liberate;
END; $$;

-- I permessi: nessun client le esegue. Il divieto va dato anche a PUBLIC, che una funzione nuova
-- riceve da sola (vedi tests/sql/rls/10-nessuna-porta-nuova-aperta-agli-anonimi.test.sql).
REVOKE ALL ON FUNCTION public.reserve_stock(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_stock(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chiudi_riserva_contanti(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.libera_riserve_orfane(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stock(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_stock(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chiudi_riserva_contanti(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.libera_riserve_orfane(int) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- RITORNO INDIETRO (rollback) — prima si guarda se restano righe:
--   SELECT count(*) FROM private.riserve_merce_contanti;
-- e, se ce ne sono, si liberano (SELECT public.libera_riserve_orfane(1);)
-- quando nessuna cassa e' in corso. Poi:
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.libera_riserve_orfane(int);
-- DROP FUNCTION IF EXISTS public.chiudi_riserva_contanti(uuid);
-- DROP FUNCTION IF EXISTS public.restore_stock(jsonb, uuid);
-- DROP FUNCTION IF EXISTS public.reserve_stock(jsonb, jsonb);
-- DROP TABLE IF EXISTS private.riserve_merce_contanti;
-- (lo schema private resta: lo usa anche la 910)
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
--
-- La rotta, senza le funzioni a due parametri, torna da sola a riservare come
-- prima (vedi `laRiservaScrittaNonCe` in app/api/orders/cod/route.ts).
-- ═══════════════════════════════════════════════════════════════════════════
