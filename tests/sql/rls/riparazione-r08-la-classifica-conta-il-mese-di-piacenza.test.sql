-- =============================================================================
-- R08-025 — La classifica del negozio del mese conta il mese di Piacenza (322)
-- =============================================================================
--   ① al confine del mese il mese è quello di Piacenza, non di Greenwich:
--     30/11 alle 23:30 UTC (00:30 del 1/12 a Piacenza) → dicembre;
--     30/6 alle 22:30 UTC (00:30 del 1/7, ora legale)   → luglio;
--     30/11 alle 22:30 UTC (23:30 a Piacenza)           → ancora novembre;
--   ② la vista dice il mese di Piacenza e conta il voto scritto con quel mese,
--     come lo scrive la pagina (primoDelMesePiacenza);
--   ③ e lo fa qualunque sia il fuso della sessione del database.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO esiti SELECT '① 00:30 del 1/12 a Piacenza è dicembre',
  public.mese_di_piacenza('2026-11-30 23:30:00+00') = DATE '2026-12-01',
  public.mese_di_piacenza('2026-11-30 23:30:00+00')::text;
INSERT INTO esiti SELECT '① 00:30 del 1/7 a Piacenza (ora legale) è luglio',
  public.mese_di_piacenza('2026-06-30 22:30:00+00') = DATE '2026-07-01',
  public.mese_di_piacenza('2026-06-30 22:30:00+00')::text;
INSERT INTO esiti SELECT '① 23:30 del 30/11 a Piacenza è ancora novembre',
  public.mese_di_piacenza('2026-11-30 22:30:00+00') = DATE '2026-11-01',
  public.mese_di_piacenza('2026-11-30 22:30:00+00')::text;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e3220000-0000-0000-0000-000000000001', 'forno-322@test.it', '{"role":"seller"}'),
  ('e3220000-0000-0000-0000-000000000003', 'maria-322@test.it', '{"role":"buyer"}');
UPDATE public.profiles SET is_approved = true, approval_status = 'approved', store_name = 'AAA Forno 322'
 WHERE id = 'e3220000-0000-0000-0000-000000000001';

-- Il voto come lo scrive la pagina: col mese di Piacenza di adesso.
INSERT INTO public.shop_of_month_votes (voter_id, seller_id, month)
VALUES ('e3220000-0000-0000-0000-000000000003', 'e3220000-0000-0000-0000-000000000001',
        date_trunc('month', now() AT TIME ZONE 'Europe/Rome')::date);

INSERT INTO esiti SELECT '② la vista conta il voto scritto col mese di Piacenza',
  coalesce((SELECT vote_count = 1 FROM public.shop_of_month_leaderboard WHERE seller_id = 'e3220000-0000-0000-0000-000000000001'), false), '';
INSERT INTO esiti SELECT '② la colonna month della vista è il mese di Piacenza',
  (SELECT bool_and(month = date_trunc('month', now() AT TIME ZONE 'Europe/Rome')::date) FROM public.shop_of_month_leaderboard), '';

-- ④ A metà mese ② e ③ passerebbero anche con la vista vecchia: il difetto vive solo nella prima ora
-- del mese, e l'orologio del database non si finge. Quindi si pretende che la vista conti i voti
-- proprio con la funzione provata al confine in ①, sia nella colonna sia nel filtro dei voti.
INSERT INTO esiti SELECT '④ la vista conta il mese con mese_di_piacenza (colonna e filtro dei voti)',
  (SELECT (length(d) - length(replace(d, 'mese_di_piacenza(', ''))) / length('mese_di_piacenza(') >= 2
            AND d NOT LIKE '%date_trunc(''month''::text, now())%'
     FROM (SELECT pg_get_viewdef('public.shop_of_month_leaderboard'::regclass, true) AS d) x),
  (SELECT pg_get_viewdef('public.shop_of_month_leaderboard'::regclass, true));

SET LOCAL TimeZone = 'Pacific/Kiritimati';
INSERT INTO esiti SELECT '③ con la sessione a UTC+14 il mese resta quello di Piacenza',
  (SELECT bool_and(month = date_trunc('month', now() AT TIME ZONE 'Europe/Rome')::date) FROM public.shop_of_month_leaderboard), '';
SET LOCAL TimeZone = 'Pacific/Pago_Pago';
INSERT INTO esiti SELECT '③ con la sessione a UTC-11 il mese resta quello di Piacenza',
  (SELECT bool_and(month = date_trunc('month', now() AT TIME ZONE 'Europe/Rome')::date) FROM public.shop_of_month_leaderboard), '';
RESET TimeZone;

DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli rossi in questo file', rossi;
  END IF;
END $$;

ROLLBACK;
