-- Sottocategorie aggiuntive per le categorie principali, così la pagina
-- /categorie e la navigazione gerarchica hanno contenuto reale.
-- Idempotente: gli slug sono univoci, on conflict non fa nulla.
-- (L'assegnazione dei prodotti esistenti alle sottocategorie è un'operazione
--  sui dati, eseguita separatamente sul progetto.)

insert into public.categories (slug, name, parent_id)
select v.slug, v.name, p.id
from (values
  ('casa-tessili',        'Tessili & Biancheria', 'casa'),
  ('casa-illuminazione',  'Illuminazione',        'casa'),
  ('casa-decorazioni',    'Decorazioni',          'casa'),
  ('casa-tavola',         'Tavola & Cucina',      'casa'),
  ('casa-arredo',         'Arredamento',          'casa'),
  ('libri-romanzi',       'Romanzi',              'libri'),
  ('libri-saggistica',    'Saggistica',           'libri'),
  ('libri-bambini',       'Bambini',              'libri'),
  ('libri-fumetti',       'Fumetti & Manga',      'libri'),
  ('elettronica-smartphone', 'Smartphone',        'elettronica'),
  ('elettronica-computer',   'Computer',          'elettronica'),
  ('elettronica-audio',      'Audio',             'elettronica'),
  ('elettronica-accessori',  'Accessori',         'elettronica')
) as v(slug, name, parent_slug)
join public.categories p on p.slug = v.parent_slug and p.parent_id is null
on conflict (slug) do nothing;
