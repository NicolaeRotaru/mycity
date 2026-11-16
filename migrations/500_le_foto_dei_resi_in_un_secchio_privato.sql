-- =============================================================================
-- 500 — LE FOTO DEI RESI IN UN MAGAZZINO CHIUSO
-- =============================================================================
--
-- NON APPLICATA. La applica Nicola: tocca il deposito in produzione.
--
-- ── Cosa c'e' che non va, in parole semplici ─────────────────────────────────
-- Quando un cliente chiede un reso puo' allegare delle foto: il pacco arrivato
-- rotto, il prodotto sbagliato. Spesso nella foto c'e' l'etichetta col suo nome
-- e il suo indirizzo. Oggi quelle foto finiscono nel magazzino `products`, che
-- e' PUBBLICO (migrations/002): chi ha l'indirizzo della foto la vede, senza
-- account, e la vede per sempre.
--
-- ── Cosa fa ──────────────────────────────────────────────────────────────────
-- Prepara un magazzino CHIUSO solo per le foto dei resi, `returns`, con gli
-- stessi due paletti degli altri magazzini di foto (10 MiB a file, i sette tipi
-- di immagine della migrations/070, compreso HEIC dell'iPhone).
--
-- Il percorso di ogni foto e' `<cliente>/<ordine>/<file>`. Le regole:
--   · scrive solo il cliente, nella sua cartella, e solo per un ordine suo;
--   · legge il cliente che l'ha caricata, il negozio di quell'ordine e
--     l'amministratore. Si guarda con un link a scadenza, mai con un indirizzo
--     pubblico;
--   · nessuno legge senza account.
--
-- La cancellazione dell'account svuota la cartella del cliente con la chiave di
-- servizio (lib/account/cancellazione.ts), che non passa da queste regole.
--
-- ── Che rischio ha ───────────────────────────────────────────────────────────
-- Nessuno sui dati che ci sono: crea un magazzino nuovo e due regole che
-- valgono solo per lui. Non sposta le foto gia' caricate in `products`: quelle
-- vanno spostate a parte (le foto vere non si muovono con l'SQL).
--
-- ── Per tornare indietro ─────────────────────────────────────────────────────
--   DROP POLICY IF EXISTS "returns insert own order" ON storage.objects;
--   DROP POLICY IF EXISTS "returns read owner seller or staff" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'returns';  -- solo se e' vuoto
--
-- LA PROVA: tests/sql/rls/riparazione-r26-foto-dei-resi.test.sql
-- =============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'returns', 'returns', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Scrive solo il cliente: prima cartella = lui, seconda = un ordine suo.
DROP POLICY IF EXISTS "returns insert own order" ON storage.objects;
CREATE POLICY "returns insert own order" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'returns'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id::text = (storage.foldername(name))[2]
         AND o.user_id = (SELECT auth.uid())
    )
  );

-- Legge il cliente, il negozio di quell'ordine (e solo se la cartella e' del
-- cliente di quell'ordine), l'amministratore.
DROP POLICY IF EXISTS "returns read owner seller or staff" ON storage.objects;
CREATE POLICY "returns read owner seller or staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'returns'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT public.is_admin())
      OR EXISTS (
        SELECT 1 FROM public.orders o
         WHERE o.id::text = (storage.foldername(name))[2]
           AND o.user_id::text = (storage.foldername(name))[1]
           AND o.seller_id = (SELECT auth.uid())
      )
    )
  );

COMMIT;
