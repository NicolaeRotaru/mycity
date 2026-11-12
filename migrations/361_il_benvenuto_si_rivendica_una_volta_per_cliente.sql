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
--     due rivendicazioni dello stesso codice si mettono in fila) e rifiuta se
--     lo stesso cliente ha gia' una rivendicazione aperta e recente;
--   · `release_coupon(p_code, p_order_id)` — quella dei percorsi di
--     annullamento che conoscono l'ordine — chiude anche la rivendicazione del
--     cliente di quell'ordine: il buono torna davvero utilizzabile (la promessa
--     del 3/9).
--
-- PERCHE' DUE ORE. Una rivendicazione piu' vecchia di due ore non blocca piu'.
-- E' quanto vive una cassa con la carta aperta (`pending_checkouts.expires_at`):
-- oltre, o l'ordine e' nato — e allora lo conta gia' `validateCoupon` — o la
-- cassa e' scaduta. Serve da rete per i rilasci che non conoscono l'ordine
-- (carrello scaduto, riserve abbandonate chiamano `release_coupon(p_code)`):
-- senza, un cliente con la cassa scaduta resterebbe senza benvenuto per sempre.
-- E' una scelta, scritta nelle domande per Nicola.
--
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
  'R12-004: chi ha rivendicato un codice first_order_only e quando. Una riga aperta da meno di 2 ore blocca la seconda rivendicazione dello stesso cliente.';

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

  IF v_primo AND p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.coupon_redemptions r
     WHERE r.coupon_id = v_id
       AND r.user_id = p_user_id
       AND r.released_at IS NULL
       AND r.claimed_at > now() - interval '2 hours'
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

-- 12/11/2026 (collaudo R12-004) — I rilasci che non conoscono l'ordine
-- (`release_coupon(p_code)`: cassa con la carta abbandonata, tetto dei contanti,
-- carrello scaduto) scalano il contatore ma non sanno di chi era la
-- rivendicazione: chi tornava indietro dalla pagina di Stripe e riapriva la cassa
-- restava senza benvenuto per due ore. Il sito, quando ha appena liberato le
-- casse abbandonate DI QUEL CLIENTE, chiude le sue rivendicazioni aperte del
-- codice prima di rivendicarlo di nuovo.
CREATE OR REPLACE FUNCTION public.chiudi_rivendicazioni_del_cliente(p_code text, p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE chiuse int;
BEGIN
  IF p_code IS NULL OR p_user_id IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.coupon_redemptions r
     SET released_at = now()
    FROM public.coupons c
   WHERE r.coupon_id = c.id
     AND c.code = upper(trim(p_code))
     AND r.user_id = p_user_id
     AND r.released_at IS NULL;
  GET DIAGNOSTICS chiuse = ROW_COUNT;
  RETURN chiuse;
END;
$function$;

REVOKE ALL ON FUNCTION public.chiudi_rivendicazioni_del_cliente(text, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.chiudi_rivendicazioni_del_cliente(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.chiudi_rivendicazioni_del_cliente(text, uuid) FROM authenticated;
