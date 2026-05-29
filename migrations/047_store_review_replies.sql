-- =============================================================================
-- 047 — Risposta del venditore alle recensioni del negozio
-- =============================================================================
-- Il venditore può rispondere pubblicamente alle recensioni ricevute
-- (store_reviews). Finora la UI esisteva ma era un mock: la risposta non veniva
-- mai salvata. Aggiungiamo le colonne sulla stessa riga della recensione (una
-- risposta per recensione). La scrittura avviene via API route
-- (withSellerAuth + verifica ownership + service role) perché store_reviews non
-- espone una policy UPDATE agli utenti; la lettura è già pubblica
-- ("Anyone can read store reviews"), quindi la risposta è visibile a tutti.

-- NB: due statement separati (uno ADD COLUMN ciascuno): il generatore di tipi
-- offline (scripts/gen-db-types.mjs) cattura una sola colonna per statement.
ALTER TABLE public.store_reviews ADD COLUMN IF NOT EXISTS seller_reply text;
ALTER TABLE public.store_reviews ADD COLUMN IF NOT EXISTS seller_reply_at timestamptz;

NOTIFY pgrst, 'reload schema';
