-- =============================================================================
-- S02-01 — una riga nuova di segnalazioni
-- =============================================================================
-- Dal browser (anonimo o con account) la riga nasce «ricevuta», senza esito, senza
-- chi ha deciso, senza data della decisione, con la data di adesso e con un id
-- scelto dal database, qualunque cosa mandi. L'amministratore e il server scrivono
-- quello che mandano, e così chi lavora direttamente sul database.
-- La regola sull'autore resta com'era.
-- Ogni invio si riconosce dal suo «dettaglio», che porta il nome del caso.
-- Migrazione: migrations/998_s02_controlli_piu_stretti.sql.
-- Gira dopo tests/sql/harness/apply.sh. Transazione con ROLLBACK finale.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('5e020100-0000-0000-0000-000000000001', 'capo-s0201@test.it',    '{"role":"admin"}'),
  ('5e020100-0000-0000-0000-000000000002', 'cliente-s0201@test.it', '{"role":"buyer"}'),
  ('5e020100-0000-0000-0000-000000000003', 'altro-s0201@test.it',   '{"role":"buyer"}');
UPDATE public.profiles SET role = 'admin' WHERE id = '5e020100-0000-0000-0000-000000000001';

RESET mycity.allow_profile_write;

CREATE TEMP TABLE risposte (caso text PRIMARY KEY, stato text, id_mandato uuid) ON COMMIT DROP;
GRANT ALL ON risposte TO anon, authenticated, service_role;

-- Una segnalazione con id, stato e decisione già scritti.
CREATE FUNCTION pg_temp.manda(p_caso text, p_id uuid, p_autore uuid, p_stato text,
                              p_esito text, p_deciso_da uuid, p_deciso_at timestamptz,
                              p_creata timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.segnalazioni (id, tipo, oggetto_id, motivo, dettaglio, segnalante_id,
                                     stato, esito_motivato, deciso_da, deciso_at, created_at)
    VALUES (p_id, 'recensione', '5e020100-0000-0000-0000-0000000000ff', 'altro', p_caso, p_autore,
            p_stato, p_esito, p_deciso_da, p_deciso_at, p_creata);
    INSERT INTO risposte VALUES (p_caso, 'ok', p_id);
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE, p_id);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.manda(text, uuid, uuid, text, text, uuid, timestamptz, timestamptz)
  TO anon, authenticated, service_role;

-- Una segnalazione come la manda chi segnala davvero: solo i campi del modulo, niente id.
CREATE FUNCTION pg_temp.manda_semplice(p_caso text, p_autore uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.segnalazioni (tipo, oggetto_id, motivo, segnalante_id, dettaglio)
    VALUES ('prodotto', '5e020100-0000-0000-0000-0000000000fe', 'ingannevole', p_autore, p_caso);
    INSERT INTO risposte VALUES (p_caso, 'ok', NULL);
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE, NULL);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.manda_semplice(text, uuid) TO anon, authenticated, service_role;

-- La prima, scritta da una funzione coi permessi del suo proprietario (SECURITY DEFINER):
-- conta chi ha fatto la richiesta, non il proprietario della funzione.
CREATE FUNCTION pg_temp.manda_come_proprietario(p_caso text, p_id uuid, p_autore uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    INSERT INTO public.segnalazioni (id, tipo, oggetto_id, motivo, dettaglio, segnalante_id,
                                     stato, esito_motivato, deciso_da, deciso_at, created_at)
    VALUES (p_id, 'recensione', '5e020100-0000-0000-0000-0000000000ff', 'altro', p_caso, p_autore,
            'accolta', 'esito da una funzione', '5e020100-0000-0000-0000-000000000001',
            '2026-01-01 10:00+01', '2025-01-01 10:00+01');
    INSERT INTO risposte VALUES (p_caso, 'ok', p_id);
  EXCEPTION WHEN others THEN
    INSERT INTO risposte VALUES (p_caso, SQLSTATE, p_id);
  END;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.manda_come_proprietario(text, uuid, uuid) TO anon, authenticated, service_role;

-- =============================================================================
-- 0. Direttamente sul database (semine, migrazioni): nessun ruolo del sito
-- =============================================================================
SELECT pg_temp.manda('database-accolta', '5e020100-0000-0000-0000-00000000e001', NULL, 'accolta',
                     'esito della semina', '5e020100-0000-0000-0000-000000000001',
                     '2026-01-01 10:00+01', '2025-01-01 10:00+01');

-- =============================================================================
-- 1. Anonimo
-- =============================================================================
SET LOCAL ROLE anon;
SELECT pg_temp.manda('anon-accolta', '5e020100-0000-0000-0000-00000000a001', NULL, 'accolta',
                     'esito scritto da fuori', '5e020100-0000-0000-0000-000000000001',
                     '2026-01-01 10:00+01', '2025-01-01 10:00+01');
SELECT pg_temp.manda('anon-respinta', '5e020100-0000-0000-0000-00000000a002', NULL, 'respinta',
                     'altro esito', NULL, '2026-02-01 10:00+01', '2025-02-01 10:00+01');
SELECT pg_temp.manda_semplice('anon-semplice', NULL);
SELECT pg_temp.manda_come_proprietario('anon-da-funzione', '5e020100-0000-0000-0000-00000000a004', NULL);
RESET ROLE;

-- =============================================================================
-- 2. Persona con l'account (non amministratore)
-- =============================================================================
SET LOCAL request.jwt.claims = '{"sub":"5e020100-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.manda('cliente-accolta', '5e020100-0000-0000-0000-00000000b001',
                     '5e020100-0000-0000-0000-000000000002', 'accolta', 'esito scritto da fuori',
                     '5e020100-0000-0000-0000-000000000001', '2026-01-01 10:00+01', '2025-01-01 10:00+01');
SELECT pg_temp.manda('cliente-in-esame', '5e020100-0000-0000-0000-00000000b002',
                     '5e020100-0000-0000-0000-000000000002', 'in_esame', NULL,
                     '5e020100-0000-0000-0000-000000000002', NULL, '2025-03-01 10:00+01');
SELECT pg_temp.manda_semplice('cliente-semplice', '5e020100-0000-0000-0000-000000000002');
SELECT pg_temp.manda_semplice('cliente-a-nome-di-un-altro', '5e020100-0000-0000-0000-000000000003');
SELECT pg_temp.manda_come_proprietario('cliente-da-funzione', '5e020100-0000-0000-0000-00000000b005',
                                       '5e020100-0000-0000-0000-000000000002');
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 3. Amministratore
-- =============================================================================
SET LOCAL request.jwt.claims = '{"sub":"5e020100-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.manda('admin-accolta', '5e020100-0000-0000-0000-00000000c001',
                     '5e020100-0000-0000-0000-000000000001', 'accolta', 'esito dell amministratore',
                     '5e020100-0000-0000-0000-000000000001', '2026-01-01 10:00+01', '2025-01-01 10:00+01');
RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- 4. Server
-- =============================================================================
SET LOCAL ROLE service_role;
SELECT pg_temp.manda('server-respinta', '5e020100-0000-0000-0000-00000000d001', NULL, 'respinta',
                     'esito del server', '5e020100-0000-0000-0000-000000000001',
                     '2026-01-01 10:00+01', '2025-01-01 10:00+01');
SELECT pg_temp.manda_semplice('server-semplice', NULL);
RESET ROLE;

-- =============================================================================
-- Controlli
-- =============================================================================
-- Nata dal browser: ricevuta, senza decisione, data di adesso, e non con l'id mandato.
CREATE FUNCTION pg_temp.nata_pulita(p_caso text) RETURNS boolean LANGUAGE sql AS $$
  SELECT (SELECT count(*) FROM public.segnalazioni WHERE dettaglio = p_caso) = 1
     AND EXISTS (
       SELECT 1 FROM public.segnalazioni s
        WHERE s.dettaglio = p_caso
          AND s.stato = 'ricevuta'
          AND s.esito_motivato IS NULL
          AND s.deciso_da IS NULL
          AND s.deciso_at IS NULL
          AND s.created_at = now()
          AND s.id IS DISTINCT FROM (SELECT id_mandato FROM risposte WHERE caso = p_caso))
     AND NOT EXISTS (
       SELECT 1 FROM public.segnalazioni
        WHERE id = (SELECT id_mandato FROM risposte WHERE caso = p_caso));
$$;

-- Scritta da chi decide: tutto come l'ha mandato, id compreso.
CREATE FUNCTION pg_temp.come_mandata(p_caso text, p_id uuid, p_stato text, p_esito text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.segnalazioni
     WHERE dettaglio = p_caso
       AND id = p_id
       AND stato = p_stato
       AND esito_motivato = p_esito
       AND deciso_da = '5e020100-0000-0000-0000-000000000001'
       AND deciso_at = '2026-01-01 10:00+01'
       AND created_at = '2025-01-01 10:00+01');
$$;

CREATE FUNCTION pg_temp.come_e(p_caso text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(
    (SELECT string_agg(format('id=%s stato=%s esito=%s deciso_da=%s deciso_at=%s created_at=%s',
                   CASE WHEN id = (SELECT id_mandato FROM risposte WHERE caso = p_caso) THEN 'quello mandato'
                        ELSE 'nuovo' END,
                   stato, coalesce(esito_motivato, '∅'), coalesce(deciso_da::text, '∅'),
                   coalesce(deciso_at::text, '∅'),
                   CASE WHEN created_at = now() THEN 'adesso' ELSE created_at::text END), ' | ')
       FROM public.segnalazioni WHERE dettaglio = p_caso),
    'riga assente');
$$;

DO $$
BEGIN
  -- Ogni invio deve essere entrato (tranne quello a nome di un altro).
  INSERT INTO esiti
  SELECT 'l invio ' || caso || ' entra', stato = 'ok', 'risposta ' || stato
    FROM risposte WHERE caso <> 'cliente-a-nome-di-un-altro';

  INSERT INTO esiti VALUES ('anon: «accolta» con id, esito, chi ha deciso e date nasce ricevuta, senza decisione e con un id nuovo',
    pg_temp.nata_pulita('anon-accolta'), pg_temp.come_e('anon-accolta'));
  INSERT INTO esiti VALUES ('anon: «respinta» con esito nasce ricevuta e senza decisione',
    pg_temp.nata_pulita('anon-respinta'), pg_temp.come_e('anon-respinta'));
  INSERT INTO esiti VALUES ('anon: la segnalazione del modulo nasce ricevuta',
    pg_temp.nata_pulita('anon-semplice'), pg_temp.come_e('anon-semplice'));
  INSERT INTO esiti VALUES ('anon: anche da una funzione SECURITY DEFINER nasce ricevuta e senza decisione',
    pg_temp.nata_pulita('anon-da-funzione'), pg_temp.come_e('anon-da-funzione'));

  INSERT INTO esiti VALUES ('cliente: «accolta» con id, esito, chi ha deciso e date nasce ricevuta, senza decisione e con un id nuovo',
    pg_temp.nata_pulita('cliente-accolta'), pg_temp.come_e('cliente-accolta'));
  INSERT INTO esiti VALUES ('cliente: «in_esame» con chi ha deciso nasce ricevuta e senza decisione',
    pg_temp.nata_pulita('cliente-in-esame'), pg_temp.come_e('cliente-in-esame'));
  INSERT INTO esiti VALUES ('cliente: la segnalazione del modulo nasce ricevuta',
    pg_temp.nata_pulita('cliente-semplice'), pg_temp.come_e('cliente-semplice'));
  INSERT INTO esiti VALUES ('cliente: anche da una funzione SECURITY DEFINER nasce ricevuta e senza decisione',
    pg_temp.nata_pulita('cliente-da-funzione'), pg_temp.come_e('cliente-da-funzione'));

  INSERT INTO esiti SELECT 'cliente: a nome di un altro resta vietata (42501)', stato = '42501', 'risposta ' || stato
    FROM risposte WHERE caso = 'cliente-a-nome-di-un-altro';
  INSERT INTO esiti VALUES ('cliente: a nome di un altro non lascia righe',
    NOT EXISTS (SELECT 1 FROM public.segnalazioni WHERE dettaglio = 'cliente-a-nome-di-un-altro'),
    pg_temp.come_e('cliente-a-nome-di-un-altro'));

  INSERT INTO esiti VALUES ('database diretto (semine, migrazioni): scrive id, stato, esito, chi ha deciso e date',
    pg_temp.come_mandata('database-accolta', '5e020100-0000-0000-0000-00000000e001', 'accolta', 'esito della semina'),
    pg_temp.come_e('database-accolta'));
  INSERT INTO esiti VALUES ('amministratore: scrive id, stato, esito, chi ha deciso e date',
    pg_temp.come_mandata('admin-accolta', '5e020100-0000-0000-0000-00000000c001', 'accolta', 'esito dell amministratore'),
    pg_temp.come_e('admin-accolta'));
  INSERT INTO esiti VALUES ('server: scrive id, stato, esito, chi ha deciso e date',
    pg_temp.come_mandata('server-respinta', '5e020100-0000-0000-0000-00000000d001', 'respinta', 'esito del server'),
    pg_temp.come_e('server-respinta'));
  INSERT INTO esiti VALUES ('server: la segnalazione del modulo nasce ricevuta',
    pg_temp.nata_pulita('server-semplice'), pg_temp.come_e('server-semplice'));
END $$;

-- =============================================================================
-- Verdetto
-- =============================================================================
DO $$
DECLARE r record; rossi int;
BEGIN
  FOR r IN SELECT * FROM esiti ORDER BY nome LOOP
    RAISE INFO '%  %  — %', CASE WHEN r.ok THEN 'ok  ' ELSE 'ROTTO' END, r.nome, r.dettaglio;
  END LOOP;
  SELECT count(*) INTO rossi FROM esiti WHERE ok IS NOT TRUE;
  IF rossi > 0 THEN
    RAISE EXCEPTION '% controlli su % sono rossi', rossi, (SELECT count(*) FROM esiti);
  END IF;
  RAISE INFO 'tutti verdi: % controlli', (SELECT count(*) FROM esiti);
END $$;

ROLLBACK;
