-- Sottocategorie per le ultime categorie principali ancora "piatte"
-- (Bellezza, Giardino, Giocattoli) + riassegnazione dei prodotti esistenti,
-- così anche queste pagine diventano hub con una rail per sottocategoria.
-- Idempotente: slug univoci (on conflict do nothing); le UPDATE agiscono solo
-- sui prodotti ancora agganciati al parent, quindi rieseguibili.
-- Stesso schema di 057_subcategories.sql / 068_sport_subcategories.sql.

-- 1) Sottocategorie
insert into public.categories (slug, name, parent_id)
select v.slug, v.name, p.id
from (values
  -- Bellezza
  ('bellezza-trucco',        'Trucco & Make-up',     'bellezza'),
  ('bellezza-skincare',      'Skincare viso',        'bellezza'),
  ('bellezza-corpo',         'Corpo & Bagno',        'bellezza'),
  ('bellezza-capelli',       'Capelli',              'bellezza'),
  ('bellezza-profumi',       'Profumi',              'bellezza'),
  -- Giardino
  ('giardino-piante',        'Piante & Fiori',       'giardino'),
  ('giardino-attrezzi',      'Attrezzi da giardino', 'giardino'),
  ('giardino-cura',          'Semi & Cura piante',   'giardino'),
  ('giardino-vasi',          'Vasi & Arredo',        'giardino'),
  -- Giocattoli (categoria ancora senza prodotti: struttura pronta per il futuro)
  ('giocattoli-costruzioni', 'Costruzioni',          'giocattoli'),
  ('giocattoli-educativi',   'Giochi educativi',     'giocattoli'),
  ('giocattoli-peluche',     'Peluche',              'giocattoli'),
  ('giocattoli-tavolo',      'Giochi da tavolo',     'giocattoli'),
  ('giocattoli-aperto',      'Giochi all''aperto',   'giocattoli')
) as v(slug, name, parent_slug)
join public.categories p on p.slug = v.parent_slug and p.parent_id is null
on conflict (slug) do nothing;

-- 2) Riassegnazione per nome (dal più specifico). Ogni UPDATE sposta le righe
--    fuori dal parent, quindi non si sovrappongono. Gli eventuali non riconosciuti
--    restano sul parent e finiscono nella rail "Altri prodotti".

-- ============ BELLEZZA ============
-- Trucco & Make-up
with parent as (select id from public.categories where slug = 'bellezza' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'bellezza-trucco')
where p.category_id = (select id from parent)
  and (p.name ilike '%cipria%' or p.name ilike '%eyeliner%' or p.name ilike '%fondotinta%'
       or p.name ilike '%mascara%' or p.name ilike '%labbra%' or p.name ilike '%ombrett%'
       or p.name ilike '%rossetto%' or p.name ilike '%make-up%' or p.name ilike '%make up%'
       or p.name ilike '%smalto%' or p.name ilike '%matita%' or p.name ilike '%trucco%');

-- Profumi
with parent as (select id from public.categories where slug = 'bellezza' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'bellezza-profumi')
where p.category_id = (select id from parent)
  and (p.name ilike '%profumo%' or p.name ilike '%eau de toilette%'
       or p.name ilike '%eau de parfum%' or p.name ilike '%fragranza%');

-- Capelli
with parent as (select id from public.categories where slug = 'bellezza' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'bellezza-capelli')
where p.category_id = (select id from parent)
  and (p.name ilike '%shampoo%' or p.name ilike '%balsamo%'
       or p.name ilike '%spazzola%' or p.name ilike '%capell%');

-- Skincare viso
with parent as (select id from public.categories where slug = 'bellezza' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'bellezza-skincare')
where p.category_id = (select id from parent)
  and (p.name ilike '%viso%' or p.name ilike '%siero%' or p.name ilike '%tonico%'
       or p.name ilike '%antieta%' or p.name ilike '%antietà%' or p.name ilike '%detergente%'
       or p.name ilike '%maschera%' or p.name ilike '%solare%' or p.name ilike '%argan%'
       or p.name ilike '%spf%');

-- Corpo & Bagno (resto: creme corpo/mani, bagno, scrub, oli)
with parent as (select id from public.categories where slug = 'bellezza' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'bellezza-corpo')
where p.category_id = (select id from parent)
  and (p.name ilike '%corpo%' or p.name ilike '%bagno%' or p.name ilike '%mani%'
       or p.name ilike '%karite%' or p.name ilike '%karité%' or p.name ilike '%scrub%'
       or p.name ilike '%olio essenziale%' or p.name ilike '%burro%' or p.name ilike '%doccia%'
       or p.name ilike '%idratante%');

-- ============ GIARDINO ============
-- Piante & Fiori
with parent as (select id from public.categories where slug = 'giardino' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'giardino-piante')
where p.category_id = (select id from parent)
  and (p.name ilike '%aloe%' or p.name ilike '%bonsai%' or p.name ilike '%cactus%'
       or p.name ilike '%ficus%' or p.name ilike '%lavanda%' or p.name ilike '%orchidea%'
       or p.name ilike '%succulenta%' or p.name ilike '%basilico%' or p.name ilike '%menta%'
       or p.name ilike '%rosmarino%' or p.name ilike '%pianta%' or p.name ilike '%aromatica%');

-- Vasi & Arredo
with parent as (select id from public.categories where slug = 'giardino' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'giardino-vasi')
where p.category_id = (select id from parent)
  and (p.name ilike '%vaso%' or p.name ilike '%cassetta%' or p.name ilike '%ombreggiante%'
       or p.name ilike '%sacchi%' or p.name ilike '%terracotta%' or p.name ilike '%fioriera%');

-- Attrezzi da giardino
with parent as (select id from public.categories where slug = 'giardino' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'giardino-attrezzi')
where p.category_id = (select id from parent)
  and (p.name ilike '%annaffiatoio%' or p.name ilike '%innaffiatoio%' or p.name ilike '%carriola%'
       or p.name ilike '%decespugliatore%' or p.name ilike '%forbici%' or p.name ilike '%potatura%'
       or p.name ilike '%attrezzi%' or p.name ilike '%soffiatore%' or p.name ilike '%tagliasiepi%'
       or p.name ilike '%vanga%' or p.name ilike '%tubo%' or p.name ilike '%guanti%'
       or p.name ilike '%cesoie%' or p.name ilike '%rastrello%' or p.name ilike '%badile%');

-- Semi & Cura piante
with parent as (select id from public.categories where slug = 'giardino' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'giardino-cura')
where p.category_id = (select id from parent)
  and (p.name ilike '%concime%' or p.name ilike '%fertilizzante%' or p.name ilike '%semi%'
       or p.name ilike '%terriccio%' or p.name ilike '%insetti%' or p.name ilike '%trappola%'
       or p.name ilike '%antiparassitar%' or p.name ilike '%semente%');
