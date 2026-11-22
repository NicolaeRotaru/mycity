-- =============================================================================
-- R02-004 · R02-013 — Un solo lavoro AI sul catalogo aperto per negozio
-- =============================================================================
--   tests/sql/harness/apply.sh mycity_test && tests/sql/harness/run.sh mycity_test
--
-- La rotta di avvio scrive con la chiave di servizio: qui si scrive come lei
-- (senza RLS) e si guarda cosa accetta il database. È quello che succedeva con
-- due avvii insieme: la lettura «nessun lavoro aperto» passava per tutti e due,
-- e tutti e due inserivano.
-- ① un lavoro in corso, e subito un secondo «in invio» dello stesso negozio:
--    il secondo non nasce (prima nascevano tutti e due, e si pagavano due lotti)
-- ② un lavoro pronto da rivedere ferma anche lui un secondo lavoro
-- ③ i lavori chiusi (applicato, annullato, fallito, errore) non fermano niente
-- ④ un altro negozio parte anche se il primo ha un lavoro aperto
-- ⑤ chiuso quello aperto, se ne avvia un altro
-- ⑥ un lavoro chiuso non si riapre accanto a uno aperto
-- Senza la 640 ①, ② e ⑥ sono rossi. ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('64064064-0000-0000-0000-000000000001', 'bottega-r02-lotto@test.it', '{"role":"seller"}'),
  ('64064064-0000-0000-0000-000000000002', 'altra-bottega-r02-lotto@test.it', '{"role":"seller"}');

-- Lavori già chiusi dello stesso negozio, di ieri.
INSERT INTO public.catalog_ai_jobs (seller_id, operation, status, created_at) VALUES
  ('64064064-0000-0000-0000-000000000001', 'improve',    'applied',  now() - interval '1 day'),
  ('64064064-0000-0000-0000-000000000001', 'redescribe', 'canceled', now() - interval '1 day'),
  ('64064064-0000-0000-0000-000000000001', 'moderate',   'failed',   now() - interval '1 day'),
  ('64064064-0000-0000-0000-000000000001', 'improve',    'error',    now() - interval '1 day');

-- ③ con quattro lavori chiusi, il primo lavoro aperto nasce
DO $$
BEGIN
  INSERT INTO public.catalog_ai_jobs (id, seller_id, operation, status, batch_id)
  VALUES ('a6406406-0000-0000-0000-000000000001', '64064064-0000-0000-0000-000000000001',
          'improve', 'processing', 'msgbatch_primo');
  INSERT INTO esiti VALUES ('i lavori chiusi non fermano il lavoro nuovo', true, 'nato');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('i lavori chiusi non fermano il lavoro nuovo', false, SQLERRM);
END $$;

-- ① il secondo avvio della gara: la sua riga nasce «in invio»
DO $$
BEGIN
  INSERT INTO public.catalog_ai_jobs (seller_id, operation, status)
  VALUES ('64064064-0000-0000-0000-000000000001', 'improve', 'submitting');
  INSERT INTO esiti VALUES ('il secondo avvio non apre un secondo lavoro', false, 'nato: due lavori aperti dello stesso negozio');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO esiti VALUES ('il secondo avvio non apre un secondo lavoro', true, 'rifiutato (23505)');
END $$;

INSERT INTO esiti
SELECT 'aperto resta un lavoro solo', count(*) = 1, 'aperti: ' || count(*)
  FROM public.catalog_ai_jobs
 WHERE seller_id = '64064064-0000-0000-0000-000000000001'
   AND status IN ('submitting', 'processing', 'ready');

-- ② pronto da rivedere: è ancora aperto
UPDATE public.catalog_ai_jobs SET status = 'ready' WHERE id = 'a6406406-0000-0000-0000-000000000001';
DO $$
BEGIN
  INSERT INTO public.catalog_ai_jobs (seller_id, operation, status)
  VALUES ('64064064-0000-0000-0000-000000000001', 'moderate', 'submitting');
  INSERT INTO esiti VALUES ('un lavoro pronto da rivedere ferma il secondo', false, 'nato: due lavori aperti dello stesso negozio');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO esiti VALUES ('un lavoro pronto da rivedere ferma il secondo', true, 'rifiutato (23505)');
END $$;

-- ④ un altro negozio
DO $$
BEGIN
  INSERT INTO public.catalog_ai_jobs (seller_id, operation, status)
  VALUES ('64064064-0000-0000-0000-000000000002', 'improve', 'submitting');
  INSERT INTO esiti VALUES ('un altro negozio avvia il suo lavoro', true, 'nato');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('un altro negozio avvia il suo lavoro', false, SQLERRM);
END $$;

-- ⑤ scartato quello aperto, se ne avvia un altro
UPDATE public.catalog_ai_jobs SET status = 'canceled' WHERE id = 'a6406406-0000-0000-0000-000000000001';
DO $$
BEGIN
  INSERT INTO public.catalog_ai_jobs (id, seller_id, operation, status)
  VALUES ('a6406406-0000-0000-0000-000000000002', '64064064-0000-0000-0000-000000000001', 'redescribe', 'submitting');
  INSERT INTO esiti VALUES ('chiuso quello aperto, il lavoro nuovo nasce', true, 'nato');
EXCEPTION WHEN others THEN
  INSERT INTO esiti VALUES ('chiuso quello aperto, il lavoro nuovo nasce', false, SQLERRM);
END $$;

-- ⑥ il lavoro scartato non torna «pronto» accanto a quello nuovo
DO $$
BEGIN
  UPDATE public.catalog_ai_jobs SET status = 'ready' WHERE id = 'a6406406-0000-0000-0000-000000000001';
  INSERT INTO esiti VALUES ('un lavoro chiuso non si riapre accanto a uno aperto', false, 'riaperto: due lavori aperti dello stesso negozio');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO esiti VALUES ('un lavoro chiuso non si riapre accanto a uno aperto', true, 'rifiutato (23505)');
END $$;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controllo/i rosso/i: un negozio può avere più di un lavoro AI aperto sul catalogo', rossi;
  END IF;
  RAISE INFO 'un solo lavoro AI aperto per negozio: % controlli verdi', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
