-- 999l (R02-002) — La spesa AI si prenota nel conto condiviso prima della chiamata.
--
-- Il tetto giornaliero della spesa AI (AI_GLOBAL_DAILY_BUDGET_EUR) si controllava
-- leggendo `ai_spend_daily` (migrazioni 131 / 158) e la spesa entrava nel conto
-- solo a chiamata finita. Le copie della funzione che partivano insieme
-- leggevano lo stesso numero e passavano tutte; con la scrittura rotta e la
-- lettura viva il tetto non frenava affatto (tetto 1 €, tre copie da duecento
-- chiamate parallele: 1,725 € spesi e il conto a zero).
--
-- Adesso (lib/ai/tettoSpesa.ts, prenotaSpesaNelContoCondiviso), in produzione:
--   prenota_spesa_ai(giorno, stima, tetto)  → controlla il tetto e scrive la
--     stima in un passo solo; torna il totale nuovo, oppure -1 se la stima non
--     ci sta (niente scritto). L'UPDATE con la condizione sul totale prende il
--     lucchetto della riga e rilegge la condizione: di due copie, la seconda
--     vede la prima.
--   restituisci_spesa_ai(giorno, cents)     → toglie la stima a chiamata finita,
--     dopo che la spesa vera e' stata registrata con registra_spesa_ai. Mai
--     sotto zero. Se non arriva (copia spenta) il conto resta piu' alto del
--     vero, mai piu' basso.
--
-- Dipende da 158 (tabella ai_spend_daily); la tabella si ricrea qui uguale, se
-- manca, perche' la migrazione si possa applicare da sola. Idempotente.
-- Senza questa migrazione il codice torna alla strada di prima (nessuna rottura).

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_spend_daily (
  giorno      date PRIMARY KEY,
  cents       bigint NOT NULL DEFAULT 0 CHECK (cents >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_spend_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_spend_daily FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prenota_spesa_ai(p_giorno date, p_cents bigint, p_tetto_cents bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cents  bigint := GREATEST(COALESCE(p_cents, 0), 1);
  v_totale bigint;
BEGIN
  IF p_giorno IS NULL OR p_tetto_cents IS NULL THEN
    RAISE EXCEPTION 'argomenti_non_validi' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_spend_daily (giorno, cents, updated_at)
  VALUES (p_giorno, 0, now())
  ON CONFLICT (giorno) DO NOTHING;

  UPDATE public.ai_spend_daily
     SET cents = cents + v_cents,
         updated_at = now()
   WHERE giorno = p_giorno
     AND cents + v_cents <= p_tetto_cents
  RETURNING cents INTO v_totale;

  IF v_totale IS NULL THEN
    RETURN -1;
  END IF;
  RETURN v_totale;
END;
$$;

CREATE OR REPLACE FUNCTION public.restituisci_spesa_ai(p_giorno date, p_cents bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_totale bigint;
BEGIN
  UPDATE public.ai_spend_daily
     SET cents = GREATEST(cents - GREATEST(COALESCE(p_cents, 0), 0), 0),
         updated_at = now()
   WHERE giorno = p_giorno
  RETURNING cents INTO v_totale;
  RETURN COALESCE(v_totale, 0);
END;
$$;

COMMENT ON FUNCTION public.prenota_spesa_ai(date, bigint, bigint) IS
  'Prenota la stima di una chiamata AI nel conto del giorno solo se il totale resta entro il tetto. Torna il totale nuovo o -1 (niente scritto).';
COMMENT ON FUNCTION public.restituisci_spesa_ai(date, bigint) IS
  'Toglie dal conto del giorno la stima prenotata da prenota_spesa_ai, a spesa vera registrata. Mai sotto zero.';

REVOKE ALL ON FUNCTION public.prenota_spesa_ai(date, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restituisci_spesa_ai(date, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prenota_spesa_ai(date, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.restituisci_spesa_ai(date, bigint) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
