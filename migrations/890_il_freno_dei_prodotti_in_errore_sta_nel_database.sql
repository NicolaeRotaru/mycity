-- =============================================================================
-- 890 — Il freno di sei ore sui prodotti importati in errore sta nel database
-- =============================================================================
-- Il freno («un prodotto importato in errore si ritenta al massimo ogni sei ore»)
-- viveva solo nel contatore di rate-limit: senza Upstash ogni copia del sito
-- contava per conto suo e ripagava le chiamate AI. L'ora dell'ultimo errore non
-- aveva un posto: external_synced_at dice solo «dati arrivati» e non si muove.
-- Questa colonna e' quel posto: la scrivono i due punti che segnano 'error'
-- (giro a orario e «aggiorna ora») e la legge ritentoDopoErroreConsentito.
-- Additiva e idempotente; nessun dato esistente cambia.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS external_sync_error_at timestamptz;

COMMENT ON COLUMN public.products.external_sync_error_at IS
  'Ora dell''ultimo aggiornamento dei dati esterni andato in errore. Serve al freno di sei ore, uguale per tutte le copie del sito.';
