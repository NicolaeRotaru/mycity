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
-- NOT VALID: le righe già scritte non si ricontrollano (una storia vive al massimo
-- 24 ore e il visore non mostra più un link che non passa la regola); la regola vale
-- per ogni storia nuova e per ogni modifica. Finché una storia vecchia con un link
-- esterno non scade, il contatore delle sue visualizzazioni non sale: l'aggiornamento
-- di track_story_view cade sulla regola. Dura al massimo un giorno.

ALTER TABLE public.seller_stories DROP CONSTRAINT IF EXISTS seller_stories_link_dentro_mycity;
ALTER TABLE public.seller_stories
  ADD CONSTRAINT seller_stories_link_dentro_mycity
  CHECK (link_url IS NULL OR (link_url ~ '^/([^/\\]|$)' AND link_url !~ '[[:cntrl:]]'))
  NOT VALID;

NOTIFY pgrst, 'reload schema';
