-- Sottocategorie aggiuntive per le categorie ancora "piatte" (Abbigliamento,
-- Alimentari, Elettronica, Libri), così il selettore in fase di inserimento
-- prodotto e le pagine-hub hanno una tassonomia completa.
--
-- SOLO ADDITIVA: crea le sottocategorie mancanti. La riassegnazione dei prodotti
-- esistenti alle sottocategorie è un'operazione sui DATI, eseguita separatamente
-- e in modo controllato (vedi nota in fondo) — come per 057_subcategories.sql.
--
-- Idempotente: gli slug sono univoci, on conflict non fa nulla.

insert into public.categories (slug, name, parent_id)
select v.slug, v.name, p.id
from (values
  -- Abbigliamento (per tipo di capo)
  ('abbigliamento-scarpe',     'Scarpe',                 'abbigliamento'),
  ('abbigliamento-capispalla', 'Giacche & Capispalla',   'abbigliamento'),
  ('abbigliamento-maglieria',  'Maglieria & Felpe',      'abbigliamento'),
  ('abbigliamento-pantaloni',  'Pantaloni & Jeans',      'abbigliamento'),
  ('abbigliamento-magliette',  'T-shirt & Camicie',      'abbigliamento'),
  ('abbigliamento-abiti',      'Abiti & Gonne',          'abbigliamento'),
  ('abbigliamento-accessori',  'Accessori & Borse',      'abbigliamento'),
  ('abbigliamento-intimo',     'Intimo & Calze',         'abbigliamento'),
  -- Alimentari
  ('alimentari-latticini',     'Latticini & Formaggi',   'alimentari'),
  ('alimentari-pasta-fresca',  'Pasta fresca',           'alimentari'),
  ('alimentari-bevande',       'Bevande',                'alimentari'),
  ('alimentari-dispensa',      'Dispensa & Conserve',    'alimentari'),
  ('alimentari-dolci',         'Dolci & Snack',          'alimentari'),
  -- Elettronica
  ('elettronica-wearable',     'Smartwatch & Wearable',  'elettronica'),
  ('elettronica-gaming',       'Gaming',                 'elettronica'),
  ('elettronica-foto',         'Foto & Video',           'elettronica'),
  -- Libri (+ cartoleria, perché molti articoli sono di cancelleria)
  ('libri-crescita-personale', 'Crescita personale',     'libri'),
  ('libri-cartoleria',         'Cartoleria',             'libri'),
  ('libri-cucina',             'Cucina',                 'libri'),
  ('libri-gialli',             'Gialli & Thriller',      'libri'),
  ('libri-arte',               'Arte & Fotografia',      'libri'),
  ('libri-storia',             'Storia',                 'libri'),
  ('libri-guide',              'Guide & Viaggi',         'libri'),
  ('libri-scolastici',         'Scolastici & Dizionari', 'libri')
) as v(slug, name, parent_slug)
join public.categories p on p.slug = v.parent_slug and p.parent_id is null
on conflict (slug) do nothing;

-- NOTA (bug "nessun prodotto in nessuna categoria"): i prodotti di Abbigliamento,
-- Alimentari, Elettronica e Libri erano tutti agganciati alla categoria di primo
-- livello, quindi le pagine sottocategoria risultavano vuote. La riassegnazione
-- per nome (pattern di 068/069) va eseguita separatamente, previa conferma,
-- perché modifica dati di prodotto esistenti.
