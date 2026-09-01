-- =========================================================
-- R135 · R142 — IL TETTO DI SPESA AI ERA UN NUMERO IN MEMORIA
-- =========================================================
-- 30/8/2026.
--
-- COSA SUCCEDEVA. `AI_GLOBAL_DAILY_BUDGET_EUR` prometteva un tetto di spesa
-- giornaliero verso Anthropic. Il contatore che doveva farlo rispettare era una
-- variabile dentro `lib/ai/run.ts`, viva solo nella memoria della singola copia
-- della funzione. Su Vercel ogni richiesta può finire su una copia diversa e
-- ogni risveglio riparte da zero: «venti euro al giorno» diventava venti euro
-- PER COPIA e PER risveglio. Il freno non frenava, e il primo segnale di un
-- ciclo impazzito sarebbe stata la fattura di fine mese.
--
-- Qui nasce la casa condivisa del conto: una riga per giorno di calendario, e
-- una sola istruzione atomica per aggiungerci sopra. L'atomicità conta: due
-- copie che spendono nello stesso istante devono sommare, non sovrascriversi.
--
-- La tabella non contiene dati di nessuna persona: solo una data e un numero.
-- Nessuno la legge dal browser — RLS accesa e nessuna policy, così passa solo
-- il service role.

CREATE TABLE IF NOT EXISTS public.ai_spend_daily (
  giorno      date PRIMARY KEY,
  cents       bigint NOT NULL DEFAULT 0 CHECK (cents >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_spend_daily IS
  'Quanto è uscito verso il fornitore AI in un giorno di calendario (Europe/Rome), sommando tutte le copie della funzione. È il freno di spesa: senza questa riga condivisa il tetto vale per copia, cioè non vale.';

ALTER TABLE public.ai_spend_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_spend_daily FROM anon, authenticated;

-- Aggiunge la spesa al giorno e restituisce il totale aggiornato. Una sola
-- istruzione: due chiamate simultanee sommano invece di perdersi.
CREATE OR REPLACE FUNCTION public.registra_spesa_ai(p_giorno date, p_cents bigint)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.ai_spend_daily AS a (giorno, cents, updated_at)
  VALUES (p_giorno, GREATEST(p_cents, 0), now())
  ON CONFLICT (giorno) DO UPDATE
    SET cents = a.cents + GREATEST(EXCLUDED.cents, 0),
        updated_at = now()
  RETURNING cents;
$$;

-- Quanto è già uscito oggi. Zero se il giorno non ha ancora una riga.
CREATE OR REPLACE FUNCTION public.spesa_ai_di_oggi(p_giorno date)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT cents FROM public.ai_spend_daily WHERE giorno = p_giorno), 0);
$$;

REVOKE ALL ON FUNCTION public.registra_spesa_ai(date, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spesa_ai_di_oggi(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registra_spesa_ai(date, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.spesa_ai_di_oggi(date) TO service_role;
