-- 361_il_benvenuto_si_rivendica_una_volta_per_cliente.sql
--
-- 12/11/2026 (R12-004) — IL CODICE «SOLO PRIMO ORDINE» SI USAVA DUE VOLTE
-- APRENDO LA CASSA IN DUE SCHEDE.
--
-- Il controllo «primo ordine» lo fa `validateCoupon` contando gli ordini del
-- cliente; poi `claim_coupon` scala il contatore senza sapere chi usa il
-- codice. Due invii quasi insieme (due schede, due carrelli) trovano tutti e
-- due zero ordini — il primo ordine non e' ancora nato, e con la carta nasce
-- solo quando Stripe conferma — e rivendicano tutti e due: 10 euro di
-- benvenuto invece di 5.
--
-- Da qui la rivendicazione sa chi e':
--   · `coupon_redemptions` tiene una riga per (codice, cliente) a ogni
--     rivendicazione di un codice first_order_only;
--   · `claim_coupon(p_code, p_user_id)` blocca la riga del codice (FOR UPDATE:
--     due rivendicazioni dello stesso codice si mettono in fila) e rifiuta se lo
--     stesso cliente sta GIA' usando il codice. «Sta usando» vuol dire una di tre
--     prove vive:
--       1. una rivendicazione di meno di DUE MINUTI (il tempo fra la
--          rivendicazione e la nascita della cassa o dell'ordine: e' la gara
--          delle due schede);
--       2. una cassa con la carta ancora aperta con quel codice
--          (pending_checkouts PENDING e non scaduta);
--       3. un ordine con quel codice non annullato, non fallito e col codice
--          non restituito (coupon_released_at vuoto).
--
-- PERCHE' COSI' (collaudo del 12/11). La prima versione teneva il lucchetto due
-- ore e lo apriva solo coi rilasci che conoscono l'ordine; poi il sito lo
-- chiudeva quando liberava una cassa abbandonata qualsiasi, e con tre schede il
-- benvenuto tornava doppio. Legare il lucchetto alle prove vive non chiede a
-- nessun percorso di rilascio di ricordarsene: una cassa scaduta o annullata,
-- un articolo esaurito, Stripe che rifiuta, un ordine annullato col codice
-- restituito spengono la prova da soli, e il cliente riprova dopo al massimo
-- due minuti.

-- La firma vecchia `claim_coupon(p_code)` resta com'e': il sito la usa come
-- ripiego finche' questa migrazione non e' applicata.
-- Non si applica da sola: la applica Nicola.

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  -- Nessuna chiave verso auth.users apposta: la riga e' un lucchetto di due ore,
  -- non un dato da conservare. Le righe di piu' di un giorno le cancella la
  -- rivendicazione stessa (vedi claim_coupon), quindi non resta niente da
  -- esportare ne' da cancellare con l'account.
  user_id     uuid NOT NULL,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_aperte
  ON public.coupon_redemptions (coupon_id, user_id) WHERE released_at IS NULL;
-- Ogni chiave esterna ha il suo indice (la cancellazione di un account non scorre la tabella).
CREATE INDEX IF NOT EXISTS coupon_redemptions_user_id ON public.coupon_redemptions (user_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_id ON public.coupon_redemptions (coupon_id);

-- Solo il server ci scrive e ci legge (le funzioni qui sotto).
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_redemptions FROM anon, authenticated;

COMMENT ON TABLE public.coupon_redemptions IS
  'R12-004: chi ha rivendicato un codice first_order_only e quando. Blocca la seconda rivendicazione dello stesso cliente per 2 minuti, poi finche c e una cassa aperta o un ordine valido col codice (claim_coupon).';

CREATE OR REPLACE FUNCTION public.claim_coupon(p_code text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_primo boolean;
BEGIN
  SELECT id, coalesce(first_order_only, false) INTO v_id, v_primo
    FROM public.coupons
   WHERE code = upper(trim(p_code))
     AND active = true
     AND (max_uses IS NULL OR uses_count < max_uses)
   FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_primo AND p_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.coupon_redemptions r
       WHERE r.coupon_id = v_id
         AND r.user_id = p_user_id
         AND r.released_at IS NULL
         AND r.claimed_at > now() - interval '2 minutes'
    )
    OR EXISTS (
      SELECT 1 FROM public.pending_checkouts pc
       WHERE pc.buyer_id = p_user_id
         AND upper(trim(pc.coupon_code)) = upper(trim(p_code))
         AND pc.status = 'PENDING'
         AND pc.expires_at > now()
    )
    OR EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.user_id = p_user_id
         AND upper(trim(o.coupon_code)) = upper(trim(p_code))
         AND o.coupon_released_at IS NULL
         AND o.delivery_status IS DISTINCT FROM 'CANCELED'
         AND o.payment_status IS DISTINCT FROM 'FAILED'
    )
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.coupons SET uses_count = coalesce(uses_count, 0) + 1 WHERE id = v_id;

  -- Pulizia: un lucchetto di piu' di un giorno non serve piu' a niente.
  DELETE FROM public.coupon_redemptions WHERE claimed_at < now() - interval '1 day';

  IF v_primo AND p_user_id IS NOT NULL THEN
    INSERT INTO public.coupon_redemptions (coupon_id, user_id) VALUES (v_id, p_user_id);
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_coupon(text, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.claim_coupon(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_coupon(text, uuid) FROM authenticated;

-- Il corpo e' quello della 200, piu' la chiusura della rivendicazione.
CREATE OR REPLACE FUNCTION public.release_coupon(p_code text, p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  marcato uuid;
  v_cliente uuid;
  nuovo int;
BEGIN
  IF p_code IS NULL OR trim(p_code) = '' OR p_order_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Il turno: solo la prima chiamata per questo ordine marca la riga.
  UPDATE public.orders
     SET coupon_released_at = now()
   WHERE id = p_order_id
     AND coupon_released_at IS NULL
  RETURNING id, user_id INTO marcato, v_cliente;

  IF marcato IS NULL THEN
    RETURN 0; -- gia' restituito (o ordine inesistente): niente da scalare
  END IF;

  UPDATE public.coupons
     SET uses_count = greatest(0, uses_count - 1)
   WHERE code = upper(trim(p_code))
  RETURNING uses_count INTO nuovo;

  -- R12-004 — il buono torna al cliente: la sua rivendicazione si chiude.
  IF v_cliente IS NOT NULL THEN
    UPDATE public.coupon_redemptions r
       SET released_at = now()
      FROM public.coupons c
     WHERE r.coupon_id = c.id
       AND c.code = upper(trim(p_code))
       AND r.user_id = v_cliente
       AND r.released_at IS NULL;
  END IF;

  RETURN coalesce(nuovo, 0);
END;
$function$;
