-- =============================================================================
-- R08-014 — La pagina «nascosta» di un negozio è già nei dati pubblici
-- =============================================================================
-- La casella dell'editor dice «Pagina nascosta (raggiungibile solo con il link
-- diretto, non nel menu)». La riparazione fa aprire la pagina a chi ha il link.
-- Questa prova dimostra che così non si espone niente di nuovo: la vista
-- `seller_public_profiles` (migrations/126, coi permessi del creatore e
-- concessa ad `anon`, commento in migrations/152) restituisce già a un visitatore
-- senza account tutta la colonna `store_site`, pagine nascoste comprese, coi
-- loro blocchi. Il «nascosta» oggi lo applicava solo il browser.
-- Tutto in transazione, ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL mycity.allow_profile_write = '1';

CREATE TEMP TABLE esiti (nome text, ok boolean, dettaglio text) ON COMMIT DROP;
GRANT ALL ON esiti TO anon, authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e0140000-0000-0000-0000-000000000001', 'forno-r08-014@test.it', '{"role":"seller"}');

UPDATE public.profiles
   SET is_approved = true, approval_status = 'approved', store_name = 'Forno R08',
       store_site = '{"version":1,"theme":"classic","pages":[
         {"id":"home","slug":"","title":"Home","visibility":"public","sections":[]},
         {"id":"feste","slug":"ordini-per-le-feste","title":"Ordini per le feste","visibility":"hidden",
          "sections":[{"id":"s1","type":"text","enabled":true,"data":{"title":"Panettoni su prenotazione","body":"Ritiro dal 20 dicembre"}}]}
       ]}'::jsonb
 WHERE id = 'e0140000-0000-0000-0000-000000000001';

RESET mycity.allow_profile_write;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
INSERT INTO esiti
SELECT 'l anonimo legge la pagina nascosta, coi suoi blocchi, da seller_public_profiles',
       coalesce((
         SELECT bool_or(p->>'visibility' = 'hidden'
                        AND p->>'slug' = 'ordini-per-le-feste'
                        AND (p->'sections'->0->'data'->>'title') = 'Panettoni su prenotazione')
           FROM public.seller_public_profiles v,
                jsonb_array_elements(v.store_site->'pages') p
          WHERE v.id = 'e0140000-0000-0000-0000-000000000001'), false),
       'se diventa falso, la pagina nascosta non è più pubblica: R08-014 va rivista (aprirla col link esporrebbe dati)';
RESET ROLE;
RESET request.jwt.claims;

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
