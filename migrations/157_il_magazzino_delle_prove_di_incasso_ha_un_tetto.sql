-- =============================================================================
-- 157 — IL MAGAZZINO DELLE PROVE D'INCASSO E' L'UNICO SENZA UN TETTO
-- =============================================================================
--
-- 🔴 NON APPLICATA. La applica Nicola: tocca il deposito in produzione.
--
-- ── Cosa c'e' che non va, in parole semplici ─────────────────────────────────
-- Quando un fattorino consegna un ordine pagato in contanti, scatta due foto:
-- i soldi che ha in mano e il pacco consegnato. Quelle foto finiscono in un
-- magazzino chiuso che si chiama `cod-proof`.
--
-- Gli altri tre magazzini di foto del sito — `products`, `reviews`, `stories` —
-- hanno due paletti scritti dentro il deposito: al massimo 10 MB a file, e solo
-- foto (`migrations/070_storage_and_rls_hardening.sql`). `cod-proof` no: la
-- `migrations/114_hardening_radiografia.sql` lo crea nudo, riga 457, con la
-- sola regola di chi puo' scrivere dentro.
--
-- Vuol dire che dentro `cod-proof` ci si puo' mettere qualunque file, di
-- qualunque peso: un video da 300 MB, un archivio, un documento. Da oggi il
-- codice del sito lo impedisce (`lib/storage/regole-secchi.ts`), ma il codice
-- e' la porta d'ingresso normale, non un muro: chi ha in mano la chiave del
-- browser di un fattorino puo' parlare col deposito direttamente e saltare la
-- porta. Il muro lo tira su solo questa migrazione.
--
-- ── Cosa fa ──────────────────────────────────────────────────────────────────
-- Mette a `cod-proof` gli stessi due paletti che hanno gia' gli altri tre:
-- 10 MiB a file, e solo i sette tipi di immagine (compreso HEIC, che e' quello
-- che scatta un iPhone). Non tocca ne' i permessi ne' i file gia' dentro.
--
-- ── Che rischio ha ───────────────────────────────────────────────────────────
-- Basso, ma non nullo, e va detto: se oggi in `cod-proof` ci fosse gia' un file
-- non-immagine o piu' pesante di 10 MB, questa migrazione NON lo cancella (i
-- limiti valgono sui caricamenti nuovi) — pero' un eventuale ri-caricamento di
-- quello stesso file verrebbe rifiutato. Da controllare prima di applicare:
--   SELECT count(*) FROM storage.objects
--    WHERE bucket_id = 'cod-proof'
--      AND (   (metadata->>'size')::bigint > 10485760
--           OR metadata->>'mimetype' NOT LIKE 'image/%' );
-- Se torna 0 — ed e' l'esito atteso, perche' finora ha caricato solo l'app dei
-- fattorini — non c'e' nessun effetto sull'esistente.
--
-- Idempotente. Sicura da ri-eseguire.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets non esiste qui (database locale senza Supabase): salto.';
    RETURN;
  END IF;

  UPDATE storage.buckets
     SET file_size_limit = 10485760,
         allowed_mime_types = ARRAY[
           'image/jpeg','image/png','image/webp','image/gif',
           'image/avif','image/heic','image/heif'
         ]
   WHERE id = 'cod-proof';
END $$;

COMMIT;
