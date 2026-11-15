-- =============================================================================
-- R17-014 — Le prenotazioni del libro dei rimborsi: chi le prende, chi le riprende, chi le vede (412)
-- =============================================================================
-- Gira contro un database ricostruito dalle migrazioni vere:
--   tests/sql/harness/apply.sh mycity_test
--   psql -X -v ON_ERROR_STOP=1 -d mycity_test -f tests/sql/rls/riparazione-r17-libro-dei-rimborsi-prenotazioni.test.sql
--
-- La prova del comportamento sui totali è riparazione-r17-libro-dei-rimborsi.test.sql. Qui:
--   ① la risposta di accumula_rimborso con la chiave: 'nuova', poi 'in_corso' finché la
--      prenotazione è fresca, 'ripresa' passati 10 minuti (il tentativo che l'aveva presa è
--      morto), 'altra_cifra' con un'altra cifra; il totale non cambia dopo la prima;
--   ② rimborso_gia_prenotato dice se la chiave è nel libro, e lo storno la toglie;
--   ③ né un cliente né un anonimo leggono o scrivono le prenotazioni, né chiamano la domanda.
-- Tutto in transazione con ROLLBACK: non lascia dati.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';
SET LOCAL mycity.allow_order_write   = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e1740000-0000-0000-0000-000000000011', 'forno-r17-014b@test.it', '{"role":"seller"}'),
  ('e1740000-0000-0000-0000-000000000012', 'maria-r17-014b@test.it', '{"role":"buyer"}');

INSERT INTO public.orders (
  id, user_id, seller_id, total_price, gross_total_cents, refunded_amount_cents, payment_method, payment_status,
  delivery_status, delivered_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip
) VALUES (
  'e1740000-0000-0000-0000-0000000000b1', 'e1740000-0000-0000-0000-000000000012', 'e1740000-0000-0000-0000-000000000011',
  40, 4000, 0, 'card', 'PAID', 'DELIVERED', now() - interval '1 day',
  'Maria', '333', 'Via A 1', 'Piacenza', '29121'
);
RESET mycity.allow_profile_write;

-- ① Le risposte con la chiave.
DO $$
DECLARE
  o uuid := 'e1740000-0000-0000-0000-0000000000b1';
  r record;
BEGIN
  SELECT * INTO r FROM public.accumula_rimborso(o, 2000, 'return_r1');
  INSERT INTO esiti VALUES ('1a la prima volta la prenotazione è nuova e somma',
    r.prenotazione = 'nuova' AND r.totale_rimborsato = 2000, format('%s, totale %s', r.prenotazione, r.totale_rimborsato));

  SELECT * INTO r FROM public.accumula_rimborso(o, 2000, 'return_r1');
  INSERT INTO esiti VALUES ('1b presa da poco: un altro tentativo la sta usando, niente si somma',
    r.prenotazione = 'in_corso' AND r.totale_rimborsato = 2000, format('%s, totale %s', r.prenotazione, r.totale_rimborsato));

  SELECT * INTO r FROM public.accumula_rimborso(o, 1500, 'return_r1');
  INSERT INTO esiti VALUES ('1c la stessa chiave con un''altra cifra non è lo stesso rimborso',
    r.prenotazione = 'altra_cifra' AND r.totale_rimborsato = 2000, format('%s, totale %s', r.prenotazione, r.totale_rimborsato));

  -- Il tentativo che l'ha presa è morto 11 minuti fa.
  UPDATE public.prenotazioni_dei_rimborsi SET preso_il = now() - interval '11 minutes'
   WHERE order_id = o AND chiave = 'return_r1';
  SELECT * INTO r FROM public.accumula_rimborso(o, 2000, 'return_r1');
  INSERT INTO esiti VALUES ('1d passati 10 minuti la riprende chi arriva, senza sommare',
    r.prenotazione = 'ripresa' AND r.totale_rimborsato = 2000, format('%s, totale %s', r.prenotazione, r.totale_rimborsato));

  SELECT * INTO r FROM public.accumula_rimborso(o, 2000, 'return_r1');
  INSERT INTO esiti VALUES ('1e ripresa, torna di chi l''ha ripresa: il tentativo dopo aspetta',
    r.prenotazione = 'in_corso', format('%s', r.prenotazione));
END $$;

-- ② La domanda «è già nel libro?» e lo storno.
DO $$
DECLARE o uuid := 'e1740000-0000-0000-0000-0000000000b1';
BEGIN
  INSERT INTO esiti VALUES ('2a la chiave prenotata è nel libro',
    public.rimborso_gia_prenotato(o, 'return_r1'), 'rimborso_gia_prenotato(return_r1)');
  INSERT INTO esiti VALUES ('2b un''altra chiave no',
    NOT public.rimborso_gia_prenotato(o, 'dispute_d1'), 'rimborso_gia_prenotato(dispute_d1)');
  PERFORM public.storna_rimborso(o, 2000, 'return_r1');
  INSERT INTO esiti VALUES ('2c dopo lo storno la chiave non è più nel libro, e il totale torna a zero',
    NOT public.rimborso_gia_prenotato(o, 'return_r1')
      AND (SELECT refunded_amount_cents FROM public.orders WHERE id = o) = 0,
    format('totale %s', (SELECT refunded_amount_cents FROM public.orders WHERE id = o)));
END $$;

-- ③ Solo il server.
INSERT INTO esiti
SELECT '3a le prenotazioni non le legge né le scrive nessun ruolo del browser',
       count(*) = 0,
       coalesce(string_agg(r.ruolo || ' ' || r.permesso, ', '), 'nessun permesso')
  FROM (VALUES ('anon'), ('authenticated')) AS g(ruolo)
  CROSS JOIN LATERAL (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(permesso)
  CROSS JOIN LATERAL (SELECT g.ruolo, p.permesso) AS r
 WHERE has_table_privilege(g.ruolo, 'public.prenotazioni_dei_rimborsi', p.permesso);

INSERT INTO esiti
SELECT '3b le funzioni del libro le chiama solo il server',
       count(*) = 0,
       coalesce(string_agg(f.proname || ' da ' || g.ruolo, ', '), 'nessuna')
  FROM pg_proc f
  JOIN pg_namespace n ON n.oid = f.pronamespace AND n.nspname = 'public'
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(ruolo)
 WHERE f.proname IN ('accumula_rimborso', 'storna_rimborso', 'rimborso_gia_prenotato')
   AND has_function_privilege(g.ruolo, f.oid, 'EXECUTE');

INSERT INTO esiti
SELECT '3c la protezione riga per riga è accesa sulle prenotazioni',
       c.relrowsecurity, format('relrowsecurity %s', c.relrowsecurity)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relname = 'prenotazioni_dei_rimborsi';

-- ── Verdetto ──────────────────────────────────────────────────────────────
DO $$
DECLARE r record; rossi int := 0;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    IF r.ok THEN
      RAISE INFO 'ok  %', r.nome;
    ELSE
      rossi := rossi + 1;
      RAISE INFO 'NO  % — %', r.nome, r.dettaglio;
    END IF;
  END LOOP;
  IF rossi > 0 THEN
    RAISE EXCEPTION 'R17-014: % controllo/i rosso/i sulle prenotazioni del libro dei rimborsi', rossi;
  END IF;
  RAISE INFO 'R17-014: % controlli verdi sulle prenotazioni', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
