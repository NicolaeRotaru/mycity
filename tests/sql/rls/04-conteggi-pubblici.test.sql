-- =============================================================================
-- I conteggi pubblici: il numero si vede, il nome no
-- =============================================================================
-- Il 19 agosto la migrazione 119 ha chiuso due elenchi che erano scaricabili
-- nome per nome: chi partecipa a un evento, chi ha votato quale negozio. Giusto.
-- Ma nessuna prova controllava l'altra meta' della cosa — che il NUMERO
-- continuasse a vedersi — e per quaranta minuti la pagina degli eventi ha
-- mostrato zero partecipanti ovunque, e la classifica zero voti ovunque.
--
-- Questo file tiene ferme tutte e due le meta' insieme. Se qualcuno riapre
-- l'elenco dei nomi, diventa rosso. Se qualcuno spegne i conteggi, diventa
-- rosso lo stesso.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'bottega4@test.it', '{"role":"seller"}'),
  ('a2222222-2222-2222-2222-222222222222', 'votante1@test.it', '{"role":"buyer"}'),
  ('a3333333-3333-3333-3333-333333333333', 'votante2@test.it', '{"role":"buyer"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', role = 'seller',
       store_name = 'Bottega quattro'
 WHERE id = 'a1111111-1111-1111-1111-111111111111';

-- Due persone diverse votano lo stesso negozio questo mese.
INSERT INTO public.shop_of_month_votes (voter_id, seller_id, month) VALUES
  ('a2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', date_trunc('month', now())::date),
  ('a3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', date_trunc('month', now())::date);

-- Un evento con due partecipanti.
INSERT INTO public.marketplace_events (id, title, description, starts_at, ends_at)
VALUES ('a9999999-9999-9999-9999-999999999999', 'Mercato di prova', 'per i test',
        now() + interval '7 days', now() + interval '8 days');

INSERT INTO public.event_rsvps (user_id, event_id) VALUES
  ('a2222222-2222-2222-2222-222222222222', 'a9999999-9999-9999-9999-999999999999'),
  ('a3333333-3333-3333-3333-333333333333', 'a9999999-9999-9999-9999-999999999999');

RESET mycity.allow_profile_write;

-- =============================================================================
-- 1. Il visitatore senza account vede i NUMERI
-- =============================================================================
SET LOCAL ROLE anon;
DO $$
DECLARE voti int; partecipanti int;
BEGIN
  SELECT vote_count INTO voti
    FROM public.shop_of_month_leaderboard
   WHERE seller_id = 'a1111111-1111-1111-1111-111111111111';

  INSERT INTO esiti VALUES (
    'la classifica mostra i voti veri a chi non ha un account',
    coalesce(voti, -1) = 2,
    'letti ' || coalesce(voti::text, 'nessuna riga') || ' voti, ne servono 2');

  SELECT c.partecipanti INTO partecipanti
    FROM public.event_rsvp_counts() c
   WHERE c.event_id = 'a9999999-9999-9999-9999-999999999999';

  INSERT INTO esiti VALUES (
    'il conteggio dei partecipanti si vede senza account',
    coalesce(partecipanti, -1) = 2,
    'letti ' || coalesce(partecipanti::text, 'nessuna riga') || ' partecipanti, ne servono 2');
END $$;

-- =============================================================================
-- 2. Lo stesso visitatore NON vede chi c'e' dietro quei numeri
-- =============================================================================
DO $$
DECLARE righe int;
BEGIN
  SELECT count(*) INTO righe FROM public.shop_of_month_votes;
  INSERT INTO esiti VALUES (
    'chi ha votato non si scarica',
    righe = 0,
    'il visitatore legge ' || righe || ' righe di voto, ne deve leggere 0');

  SELECT count(*) INTO righe FROM public.event_rsvps;
  INSERT INTO esiti VALUES (
    'chi partecipa non si scarica',
    righe = 0,
    'il visitatore legge ' || righe || ' iscrizioni, ne deve leggere 0');
END $$;

RESET ROLE;

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE NOT ok;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
