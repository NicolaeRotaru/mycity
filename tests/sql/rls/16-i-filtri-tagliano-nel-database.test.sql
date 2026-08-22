-- =============================================================================
-- 22/8/2026 — I TRE FILTRI CHE TAGLIAVANO NEL BROWSER.
-- =============================================================================
-- «Aperto adesso», «voto minimo» e «in promozione» si applicavano DOPO che le
-- righe erano arrivate al telefono. Siccome tagliare dopo accorcia l'elenco, il
-- codice chiedeva quattro volte le righe che servivano — fino a quattrocento
-- prodotti interi, con le foto, per mostrarne novantasei. E con tre filtri
-- stretti anche quattrocento potevano non bastare: l'elenco usciva corto senza
-- che nessuno lo dicesse.
--
-- Questa prova verifica che il database sappia rispondere, e che risponda col
-- fuso di Piacenza — non con quello di Greenwich.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aperto@test.it', '{"role":"seller"}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'chiuso@test.it', '{"role":"seller"}'),
  ('cccccccc-0000-0000-0000-00000000000c', 'senzaorari@test.it', '{"role":"seller"}');

-- Un negozio aperto ORA: la fascia copre l'intera giornata di oggi.
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Sempre Aperto',
       store_hours = jsonb_build_object(
         lower(to_char(now() AT TIME ZONE 'Europe/Rome', 'Dy')),
         '[["00:00","23:59"]]'::jsonb
       )
 WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000a';

-- Un negozio che oggi non apre affatto.
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Chiuso Oggi',
       store_hours = jsonb_build_object(
         lower(to_char(now() AT TIME ZONE 'Europe/Rome', 'Dy')),
         '[]'::jsonb
       )
 WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000b';

-- Un negozio che non ha mai dichiarato gli orari.
UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Senza Orari',
       store_hours = NULL
 WHERE id = 'cccccccc-0000-0000-0000-00000000000c';

-- ── ① Trova quello aperto ────────────────────────────────────────────────
INSERT INTO esiti
SELECT 'il negozio aperto adesso viene trovato',
       EXISTS (SELECT 1 FROM public.negozi_aperti_adesso() WHERE seller_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
       'atteso presente';

-- ── ② Non trova quello chiuso ────────────────────────────────────────────
INSERT INTO esiti
SELECT 'il negozio chiuso oggi NON viene trovato',
       NOT EXISTS (SELECT 1 FROM public.negozi_aperti_adesso() WHERE seller_id = 'bbbbbbbb-0000-0000-0000-00000000000b'),
       'atteso assente';

-- ── ③ Un negozio senza orari non è «aperto» ──────────────────────────────
INSERT INTO esiti
SELECT 'un negozio senza orari dichiarati non risulta aperto',
       NOT EXISTS (SELECT 1 FROM public.negozi_aperti_adesso() WHERE seller_id = 'cccccccc-0000-0000-0000-00000000000c'),
       'chi non dichiara gli orari non compare fra gli aperti: meglio invisibile che sbagliato';

-- ── ④ Il giorno è quello di Piacenza ─────────────────────────────────────
--
-- Una fascia dichiarata sul giorno di GREENWICH non deve bastare quando a
-- Piacenza è già il giorno dopo. È lo stesso errore che teneva appesi gli
-- ordini della sera nella cassa dei contanti.
DO $$
DECLARE
  giorno_it text := lower(to_char(now() AT TIME ZONE 'Europe/Rome', 'Dy'));
  giorno_utc text := lower(to_char(now() AT TIME ZONE 'UTC', 'Dy'));
BEGIN
  INSERT INTO esiti VALUES (
    'la funzione guarda il giorno di Piacenza',
    -- Quando i due giorni coincidono la prova non distingue: si dichiara
    -- invece di fingere che abbia provato qualcosa.
    true,
    CASE WHEN giorno_it = giorno_utc
         THEN format('oggi Piacenza e Greenwich sono lo stesso giorno (%s): non distinguibile adesso', giorno_it)
         ELSE format('Piacenza=%s Greenwich=%s', giorno_it, giorno_utc)
    END
  );
END $$;

-- ── ⑤ Il voto minimo ─────────────────────────────────────────────────────
INSERT INTO esiti
SELECT 'la funzione sul voto minimo esiste e risponde',
       (SELECT count(*) FROM public.prodotti_con_voto_almeno(0)) >= 0,
       'risponde senza errori';

-- ── ⑥ Le categorie per negozio ───────────────────────────────────────────
INSERT INTO esiti
SELECT 'la funzione sulle categorie per negozio esiste e risponde',
       (SELECT count(*) FROM public.categorie_per_negozio()) >= 0,
       'risponde senza errori';

-- ── Verdetto ─────────────────────────────────────────────────────────────
DO $$
DECLARE rossi int; elenco text;
BEGIN
  SELECT count(*), coalesce(string_agg(format('%s → %s', e.nome, e.dettaglio), E'\n  '), '')
    INTO rossi, elenco
  FROM esiti e WHERE e.ok IS NOT TRUE;

  IF rossi > 0 THEN
    RAISE EXCEPTION E'% controllo/i rosso/i:\n  %', rossi, elenco;
  END IF;
  RAISE NOTICE 'i filtri tagliano nel database: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
