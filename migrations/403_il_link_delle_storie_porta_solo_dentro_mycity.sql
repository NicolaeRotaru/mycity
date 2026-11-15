-- 403 — Il «Scopri di più» di una storia porta solo dentro MyCity (R16-011)
--
-- Il difetto: `seller_stories.link_url` (035) è testo libero. La pagina delle storie
-- del negozio lo salvava così com'era e il visore lo apriva: una storia della vetrina
-- poteva portare il cliente su un sito qualunque, senza nessun avviso.
--
-- La cura: il link, se c'è, è un percorso del sito. Comincia con «/» ma non con «//»
-- né con «/\» (che il browser legge come un altro sito), e non ha caratteri di
-- controllo. È la stessa regola che la pagina e il visore usano dal lato del browser
-- (lib/safe-redirect.ts).
--
-- Il vincolo vale su tutte le righe (niente NOT VALID, come chiede la prova 14 e come
-- fanno la 149 e la 272): prima si toglie il link alle storie già scritte che non
-- passano la regola, DICENDO quante sono. Il visore non mostrava già più quei link,
-- quindi al cliente non cambia niente; la storia resta, senza il bottone.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  UPDATE public.seller_stories
     SET link_url = NULL
   WHERE link_url IS NOT NULL
     AND NOT (link_url ~ '^/([^/\\]|$)' AND link_url !~ '[[:cntrl:]]');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '403: % storie avevano un link che non porta dentro MyCity, tolto', n;
END $$;

ALTER TABLE public.seller_stories DROP CONSTRAINT IF EXISTS seller_stories_link_dentro_mycity;
ALTER TABLE public.seller_stories
  ADD CONSTRAINT seller_stories_link_dentro_mycity
  CHECK (link_url IS NULL OR (link_url ~ '^/([^/\\]|$)' AND link_url !~ '[[:cntrl:]]'));

COMMIT;

NOTIFY pgrst, 'reload schema';
