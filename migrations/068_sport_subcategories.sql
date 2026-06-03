-- Sottocategorie per "Sport" + riassegnazione dei prodotti esistenti, così la
-- pagina-hub /category/sport mostra una rail scrollabile per ogni sottocategoria
-- (come Abbigliamento, Casa, Elettronica, Libri).
-- Idempotente: gli slug sono univoci (on conflict do nothing); le UPDATE agiscono
-- solo sui prodotti ancora agganciati al parent "Sport", quindi rieseguibili.
-- Stesso schema di 057_subcategories.sql.

-- 1) Sottocategorie di Sport
insert into public.categories (slug, name, parent_id)
select v.slug, v.name, p.id
from (values
  ('sport-fitness',       'Fitness & Palestra',     'sport'),
  ('sport-running',       'Running',                'sport'),
  ('sport-yoga',          'Yoga & Pilates',         'sport'),
  ('sport-abbigliamento', 'Abbigliamento sportivo', 'sport')
) as v(slug, name, parent_slug)
join public.categories p on p.slug = v.parent_slug and p.parent_id is null
on conflict (slug) do nothing;

-- 2) Riassegnazione per nome (dal più specifico). Ogni UPDATE sposta le righe
--    fuori dal bucket "Sport", quindi non si sovrappongono. I prodotti non
--    riconosciuti restano su "Sport" e finiscono nella rail "Altri prodotti".

-- Yoga & Pilates
with sport as (select id from public.categories where slug = 'sport' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'sport-yoga')
where p.category_id = (select id from sport)
  and (p.name ilike '%yoga%' or p.name ilike '%pilates%' or p.name ilike '%tappetino%');

-- Running (incluse le scarpe sportive)
with sport as (select id from public.categories where slug = 'sport' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'sport-running')
where p.category_id = (select id from sport)
  and (p.name ilike '%running%' or p.name ilike '%corsa%' or p.name ilike '%jogging%'
       or p.name ilike '%scarpe%');

-- Fitness & Palestra (attrezzi)
with sport as (select id from public.categories where slug = 'sport' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'sport-fitness')
where p.category_id = (select id from sport)
  and (p.name ilike '%manubri%' or p.name ilike '%bilanciere%' or p.name ilike '%kettlebell%'
       or p.name ilike '%peso%' or p.name ilike '%pesi%' or p.name ilike '%panca%'
       or p.name ilike '%fitness%' or p.name ilike '%palestra%' or p.name ilike '%elastic%'
       or p.name ilike '%addominal%' or p.name ilike '%fascia%' or p.name ilike '%corda%');

-- Abbigliamento sportivo
with sport as (select id from public.categories where slug = 'sport' and parent_id is null)
update public.products p
set category_id = (select id from public.categories where slug = 'sport-abbigliamento')
where p.category_id = (select id from sport)
  and (p.name ilike '%tuta%' or p.name ilike '%maglia%' or p.name ilike '%felpa%'
       or p.name ilike '%pantalon%' or p.name ilike '%short%' or p.name ilike '%canotta%'
       or p.name ilike '%calza%' or p.name ilike '%leggings%' or p.name ilike '%giacca%');
