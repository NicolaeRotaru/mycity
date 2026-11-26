-- =========================================================
-- R20-002 — IL CONTO DELLA SPESA AI RESTITUISCE LE PRENOTAZIONI
-- =========================================================
-- 26/11/2026.
--
-- COSA SUCCEDEVA. Il tetto giornaliero della spesa AI (`AI_GLOBAL_DAILY_BUDGET_EUR`)
-- in rete contava per copia: ogni copia del sito, quando il conto condiviso non
-- rispondeva, ripiegava sul suo contatore in memoria; una spesa che non si
-- riusciva a scrivere restava solo nella memoria di quella copia; e senza Upstash
-- le chiamate in volo di due copie non si vedevano (conto a 99 su 100, due
-- chiamate insieme, passavano tutte e due e il conto arrivava a 101).
--
-- COSA CAMBIA. In rete il codice (lib/ai/tettoSpesa.ts, lib/ai/run.ts) PRENOTA la
-- stima di ogni chiamata nel conto condiviso prima di chiamare il modello:
-- `registra_spesa_ai(giorno, stima)`, un'aggiunta atomica che torna il totale. Se
-- il totale passa il tetto la prenotazione si restituisce e la chiamata non parte.
-- Finita la chiamata si scrive il costo vero e si restituisce la stima.
-- Restituire vuol dire aggiungere un numero NEGATIVO: fino a qui la funzione lo
-- ignorava (`GREATEST(p_cents, 0)`), e ogni prenotazione restava nel conto per
-- sempre. Adesso un negativo fa scendere il conto, mai sotto zero.
--
-- Chi la chiamava prima passa sempre un numero positivo (lib/ai/tettoSpesa.ts:
-- almeno un centesimo): per loro non cambia niente.
--
-- QUESTO FILE BASTA DA SOLO. Come la 158, crea la tabella se non c'e' e (ri)scrive
-- le due funzioni del conto: in produzione la 131 non e' mai stata applicata, e
-- applicare questa sola porta il conto intero. `spesa_ai_di_oggi` e' identica a
-- quella della 158; i permessi sono quelli della 158 e della 425 (solo il
-- service role). Tutto in una transazione, per la ragione scritta nella 158: o
-- esiste la funzione gia' chiusa, o non esiste niente.
--
-- NON SI APPLICA DA SOLA: lo decide Nicola. Finche' non c'e', in rete l'AI a
-- pagamento resta ferma con un errore temporaneo (il conto non risponde); se c'e'
-- la 158 ma non questa, le prenotazioni non si restituiscono e il tetto si
-- raggiunge prima del dovuto (mai dopo).

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_spend_daily (
  giorno      date PRIMARY KEY,
  cents       bigint NOT NULL DEFAULT 0 CHECK (cents >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_spend_daily IS
  'Quanto è uscito verso il fornitore AI in un giorno di calendario (Europe/Rome), sommando tutte le copie della funzione. È il freno di spesa: senza questa riga condivisa il tetto vale per copia, cioè non vale.';

ALTER TABLE public.ai_spend_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_spend_daily FROM PUBLIC, anon, authenticated;

-- Aggiunge (o, con un numero negativo, restituisce) la spesa del giorno e torna
-- il totale aggiornato. Una sola istruzione: due copie nello stesso istante
-- sommano invece di sovrascriversi, e la seconda vede la prima. Mai sotto zero.
CREATE OR REPLACE FUNCTION public.registra_spesa_ai(p_giorno date, p_cents bigint)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.ai_spend_daily AS a (giorno, cents, updated_at)
  VALUES (p_giorno, GREATEST(COALESCE(p_cents, 0), 0), now())
  ON CONFLICT (giorno) DO UPDATE
    SET cents = GREATEST(a.cents + COALESCE(p_cents, 0), 0),
        updated_at = now()
  RETURNING cents;
$$;

-- Quanto è già uscito oggi. Zero se il giorno non ha ancora una riga. (Come la 158.)
CREATE OR REPLACE FUNCTION public.spesa_ai_di_oggi(p_giorno date)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT cents FROM public.ai_spend_daily WHERE giorno = p_giorno), 0);
$$;

-- Restituire soldi al conto e' un potere: solo il server. PUBLIC e anon si
-- chiudono tutti e due (la lezione della 151 e della 158).
REVOKE ALL ON FUNCTION public.registra_spesa_ai(date, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spesa_ai_di_oggi(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registra_spesa_ai(date, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.spesa_ai_di_oggi(date) TO service_role;

COMMIT;

-- =========================================================
-- RITORNO INDIETRO (rollback)
-- =========================================================
-- La tabella NON si tocca: e' il conto della spesa vera (vedi la 158). Per
-- tornare alla funzione che ignora i negativi basta riscriverla com'era nella
-- 158 (`GREATEST(p_cents, 0)` nell'inserimento e nell'aggiornamento). Il codice
-- regge: le restituzioni non scendono piu' e il tetto si raggiunge prima.
-- =========================================================
