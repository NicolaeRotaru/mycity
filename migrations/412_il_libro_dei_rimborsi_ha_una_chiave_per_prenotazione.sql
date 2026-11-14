-- =============================================================================
-- 412 — Il libro dei rimborsi ha una chiave per ogni prenotazione (R17-014)
-- =============================================================================
-- IL DIFETTO. `accumula_rimborso` (119, 124, 161) somma al totale rimborsato
-- dell'ordine qualunque cifra gli arrivi, senza sapere di quale rimborso sia.
-- `refundOrder` (lib/stripe/payout.ts) prenota la cifra PRIMA di chiamare
-- Stripe, e a Stripe passa una chiave stabile (`return_<id>`, `dispute_<id>`,
-- `veloce_non_confermata_<id>`): Stripe con la stessa chiave rimborsa una
-- volta sola, il libro no. Due rimborsi dello stesso reso lanciati nello stesso
-- istante segnavano 40 € su 20 € usciti; due giri del freno della veloce
-- sovrapposti segnavano 2 € su 1; un giro morto fra la prenotazione e Stripe
-- lasciava 1 € prenotato che nessun tentativo riconosceva come suo.
--
-- LA CURA. Ogni prenotazione con una chiave lascia una riga in
-- `prenotazioni_dei_rimborsi` (ordine, chiave, centesimi, quando l'ha presa
-- l'ultimo tentativo), scritta nella STESSA istruzione che somma il totale,
-- con l'ordine bloccato (FOR UPDATE). La stessa chiave sullo stesso ordine
-- prenota una volta sola, e la risposta dice com'è andata (`prenotazione`):
--   · 'nuova'       la prima volta: la cifra si somma, come prima;
--   · 'in_corso'    c'è già, presa meno di 10 minuti fa: un altro tentativo
--                   la sta usando adesso (le funzioni del sito durano al più
--                   5 minuti, vercel.json). Niente si somma, chi chiama si
--                   ferma e riprova dopo;
--   · 'ripresa'     c'è già, presa più di 10 minuti fa: il tentativo che l'ha
--                   presa è morto. Niente si somma; questo tentativo la prende
--                   (e il suo orario) e finisce il lavoro;
--   · 'altra_cifra' c'è già, con un'altra cifra: non è lo stesso rimborso.
-- Senza chiave (`p_chiave` NULL) la funzione fa quello che faceva.
-- `storna_rimborso` con la chiave toglie la prenotazione di QUELLA chiave, se
-- c'è, e la sua cifra; se non c'è non toglie niente (uno storno ripetuto, o di
-- un tentativo che non aveva prenotato, non cancella il rimborso di un altro).
-- `rimborso_gia_prenotato` risponde se una chiave ha la sua prenotazione: è
-- la domanda «questo rimborso è già nel libro?» che il sito faceva con un
-- conto sui totali (lib/stripe/payout.ts, `nonContato`).
--
-- Le firme vecchie di accumula_rimborso e storna_rimborso si tolgono e
-- rinascono con la chiave in fondo, facoltativa: chi le chiama senza chiave
-- (PostgREST con { p_order_id, p_delta }) trova la funzione di prima.
-- Solo il server: la tabella non ha regole per il browser e i permessi sono
-- tolti ad anon e authenticated, come per le funzioni (125, 151).
--
-- Riapplicabile. Non applicata: la applica Nicola. Finché non c'è, il sito
-- riconosce la risposta di PostgREST «funzione non trovata» e prenota senza
-- chiave, come prima.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.prenotazioni_dei_rimborsi (
  order_id  uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  chiave    text        NOT NULL CHECK (length(chiave) BETWEEN 1 AND 200),
  centesimi integer     NOT NULL CHECK (centesimi > 0),
  preso_il  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, chiave)
);

COMMENT ON TABLE public.prenotazioni_dei_rimborsi IS
  'Una riga per ogni rimborso prenotato con una chiave (accumula_rimborso): la stessa chiave non si somma due volte. Solo il server.';

ALTER TABLE public.prenotazioni_dei_rimborsi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prenotazioni_dei_rimborsi FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prenotazioni_dei_rimborsi TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- accumula_rimborso: la somma col tetto del lordo (161), più la chiave.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.accumula_rimborso(uuid, integer);

CREATE OR REPLACE FUNCTION public.accumula_rimborso(p_order_id uuid, p_delta integer, p_chiave text DEFAULT NULL)
 RETURNS TABLE(totale_rimborsato integer, totale_ordine integer, prenotazione text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tot   int;
  ora   int;
  nuovo int;
  gia   int;
  preso timestamptz;
BEGIN
  IF p_delta <= 0 THEN
    RAISE EXCEPTION 'accumula_rimborso: importo non valido' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(o.gross_total_cents, round(coalesce(o.total_price, 0) * 100)::int),
         coalesce(o.refunded_amount_cents, 0)
    INTO tot, ora
    FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;

  IF tot IS NULL THEN
    RAISE EXCEPTION 'accumula_rimborso: ordine inesistente' USING ERRCODE = 'P0002';
  END IF;

  IF p_chiave IS NOT NULL THEN
    SELECT p.centesimi, p.preso_il INTO gia, preso
      FROM public.prenotazioni_dei_rimborsi p
     WHERE p.order_id = p_order_id AND p.chiave = p_chiave;
    IF FOUND THEN
      IF gia <> p_delta THEN
        RETURN QUERY SELECT ora, tot, 'altra_cifra'::text;
        RETURN;
      END IF;
      IF preso > now() - interval '10 minutes' THEN
        RETURN QUERY SELECT ora, tot, 'in_corso'::text;
        RETURN;
      END IF;
      UPDATE public.prenotazioni_dei_rimborsi p
         SET preso_il = now()
       WHERE p.order_id = p_order_id AND p.chiave = p_chiave;
      RETURN QUERY SELECT ora, tot, 'ripresa'::text;
      RETURN;
    END IF;
  END IF;

  UPDATE public.orders o
     SET refunded_amount_cents = coalesce(o.refunded_amount_cents, 0) + p_delta
   WHERE o.id = p_order_id
     AND coalesce(o.refunded_amount_cents, 0) + p_delta <= tot
  RETURNING o.refunded_amount_cents INTO nuovo;

  IF nuovo IS NULL THEN
    -- Nessuna riga rivendicata: si sfonderebbe il lordo dell'ordine.
    RETURN;
  END IF;

  IF p_chiave IS NOT NULL THEN
    INSERT INTO public.prenotazioni_dei_rimborsi (order_id, chiave, centesimi)
    VALUES (p_order_id, p_chiave, p_delta);
  END IF;

  RETURN QUERY SELECT nuovo, tot, 'nuova'::text;
END;
$function$;

COMMENT ON FUNCTION public.accumula_rimborso(uuid, integer, text) IS
  'Somma un rimborso al totale dell ordine, col tetto del lordo. Con la chiave, la stessa chiave si somma una volta sola (412). Solo il server.';

REVOKE ALL ON FUNCTION public.accumula_rimborso(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accumula_rimborso(uuid, integer, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- storna_rimborso: disfa la prenotazione di un rimborso non uscito (125), più la chiave.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.storna_rimborso(uuid, integer);

CREATE OR REPLACE FUNCTION public.storna_rimborso(p_order_id uuid, p_delta integer, p_chiave text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  nuovo int;
  tolti int;
BEGIN
  IF p_delta <= 0 THEN
    RAISE EXCEPTION 'storna_rimborso: importo non valido' USING ERRCODE = '22023';
  END IF;

  IF p_chiave IS NOT NULL THEN
    SELECT coalesce(o.refunded_amount_cents, 0) INTO nuovo
      FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'storna_rimborso: ordine inesistente' USING ERRCODE = 'P0002';
    END IF;
    DELETE FROM public.prenotazioni_dei_rimborsi p
     WHERE p.order_id = p_order_id AND p.chiave = p_chiave
    RETURNING p.centesimi INTO tolti;
    IF tolti IS NULL THEN
      -- Questa chiave non ha prenotazione: niente da togliere.
      RETURN nuovo;
    END IF;
  ELSE
    tolti := p_delta;
  END IF;

  UPDATE public.orders o
     SET refunded_amount_cents = greatest(coalesce(o.refunded_amount_cents, 0) - tolti, 0)
   WHERE o.id = p_order_id
  RETURNING o.refunded_amount_cents INTO nuovo;

  IF nuovo IS NULL THEN
    RAISE EXCEPTION 'storna_rimborso: ordine inesistente' USING ERRCODE = 'P0002';
  END IF;

  RETURN nuovo;
END;
$function$;

COMMENT ON FUNCTION public.storna_rimborso(uuid, integer, text) IS
  'Disfa la registrazione di un rimborso che non è uscito. Con la chiave toglie solo la prenotazione di quella chiave (412). Solo il server.';

REVOKE ALL ON FUNCTION public.storna_rimborso(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storna_rimborso(uuid, integer, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- rimborso_gia_prenotato: questa chiave è già nel libro di questo ordine?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rimborso_gia_prenotato(p_order_id uuid, p_chiave text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.prenotazioni_dei_rimborsi p
     WHERE p.order_id = p_order_id AND p.chiave = p_chiave
  );
$function$;

COMMENT ON FUNCTION public.rimborso_gia_prenotato(uuid, text) IS
  'Vero se il rimborso di questa chiave è prenotato nel libro dell ordine (412). Solo il server.';

REVOKE ALL ON FUNCTION public.rimborso_gia_prenotato(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rimborso_gia_prenotato(uuid, text) TO service_role;
