-- =============================================================================
-- onda2_A_2 — Gli sconti degli eventi si archiviano prima di toglierli
-- =============================================================================
-- ⚠ ORDINE: va applicata PRIMA della 880 (un_evento_non_promette_uno_sconto_che_la_cassa_non_applica),
-- che azzera marketplace_events.discount_percent. Da rinumerare 879 (libero). Applicata dopo la 880
-- non archivia niente (non resta nessuno sconto da leggere) e non fa danni.
--
-- IL DIFETTO (R01-002). La pagina Eventi mostrava «-{discount_percent}%» sulla copertina, ma nessun
-- calcolo del prezzo legge quello sconto: il cliente vedeva «-20%» e pagava il prezzo pieno. La 880
-- toglie gli sconti salvati e vieta di salvarne altri; tolti, non resterebbe scritto quali eventi
-- hanno mostrato quale sconto e quando. Quella traccia serve se un cliente contesta il prezzo pagato.
--
-- LA CURA. Prima dell'azzeramento, ogni evento con uno sconto salvato si copia qui: titolo, sconto,
-- stato e date. `event_id` senza chiave esterna apposta: la traccia resta anche se l'evento si cancella.
-- Nello schema `private`: nessuna regola per il browser, la legge solo chi ha accesso al database.
--
-- Si puo' rieseguire (ON CONFLICT DO NOTHING). NON si applica a mano: lo decide Nicola.
-- REVERSIBILE: DROP TABLE private.sconti_eventi_archiviati;  (si perde la traccia)
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.sconti_eventi_archiviati (
  event_id          uuid PRIMARY KEY,
  title             text NOT NULL,
  discount_percent  integer NOT NULL,
  status            text NOT NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  event_created_at  timestamptz NOT NULL,
  archiviato_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.sconti_eventi_archiviati ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.sconti_eventi_archiviati FROM PUBLIC, anon, authenticated;

INSERT INTO private.sconti_eventi_archiviati (event_id, title, discount_percent, status, starts_at, ends_at, event_created_at)
SELECT id, title, discount_percent, status, starts_at, ends_at, created_at
  FROM public.marketplace_events
 WHERE discount_percent IS NOT NULL
ON CONFLICT (event_id) DO NOTHING;

COMMIT;
