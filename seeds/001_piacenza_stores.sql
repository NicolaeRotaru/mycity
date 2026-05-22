-- Seed data per Piacenza Market: 2 negozi per categoria + ~15 prodotti per negozio
--
-- ATTENZIONE: crea 16 utenti finti in auth.users con password demo "PiacenzaDemo2025!"
-- ed email tipo nome.negozio@piacenza-demo.local
--
-- Idempotente: ri-eseguibile senza errori (usa UUID deterministici + ON CONFLICT DO NOTHING).
--
-- Per cancellare tutto il seed:
--   DELETE FROM auth.users WHERE email LIKE '%@piacenza-demo.local';
--   (la CASCADE su profiles cancella anche i profili, e i prodotti vanno a seller_id=NULL)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  pwd text := crypt('PiacenzaDemo2025!', gen_salt('bf'));

  -- UUID deterministici per i 16 negozi (cosi' il seed e' rerunnable)
  s_aliment1   uuid := '11111111-1111-1111-1111-aaaaaaaa0001';
  s_aliment2   uuid := '11111111-1111-1111-1111-aaaaaaaa0002';
  s_abbigl1    uuid := '11111111-1111-1111-1111-bbbbbbbb0001';
  s_abbigl2    uuid := '11111111-1111-1111-1111-bbbbbbbb0002';
  s_casa1      uuid := '11111111-1111-1111-1111-cccccccc0001';
  s_casa2      uuid := '11111111-1111-1111-1111-cccccccc0002';
  s_elettr1    uuid := '11111111-1111-1111-1111-dddddddd0001';
  s_elettr2    uuid := '11111111-1111-1111-1111-dddddddd0002';
  s_libri1     uuid := '11111111-1111-1111-1111-eeeeeeee0001';
  s_libri2     uuid := '11111111-1111-1111-1111-eeeeeeee0002';
  s_giard1     uuid := '11111111-1111-1111-1111-ffffffff0001';
  s_giard2     uuid := '11111111-1111-1111-1111-ffffffff0002';
  s_bellez1    uuid := '11111111-1111-1111-1111-99999999a001';
  s_bellez2    uuid := '11111111-1111-1111-1111-99999999a002';
  s_sport1     uuid := '11111111-1111-1111-1111-88888888a001';
  s_sport2     uuid := '11111111-1111-1111-1111-88888888a002';

  -- Lookup categorie
  c_aliment uuid;
  c_abbigl  uuid;
  c_casa    uuid;
  c_elettr  uuid;
  c_libri   uuid;
  c_giard   uuid;
  c_bellez  uuid;
  c_sport   uuid;

BEGIN
  SELECT id INTO c_aliment FROM categories WHERE slug = 'alimentari';
  SELECT id INTO c_abbigl  FROM categories WHERE slug = 'abbigliamento';
  SELECT id INTO c_casa    FROM categories WHERE slug = 'casa';
  SELECT id INTO c_elettr  FROM categories WHERE slug = 'elettronica';
  SELECT id INTO c_libri   FROM categories WHERE slug = 'libri';
  SELECT id INTO c_giard   FROM categories WHERE slug = 'giardino';
  SELECT id INTO c_bellez  FROM categories WHERE slug = 'bellezza';
  SELECT id INTO c_sport   FROM categories WHERE slug = 'sport';

  ----------------------------------------------------------------
  -- 1) auth.users (il trigger handle_new_user crea i profili)
  ----------------------------------------------------------------
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, is_sso_user
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', s_aliment1, 'authenticated', 'authenticated', 'salumeria.borgo@piacenza-demo.local',     pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_aliment2, 'authenticated', 'authenticated', 'frutteto.verde@piacenza-demo.local',      pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_abbigl1,  'authenticated', 'authenticated', 'boutique.eleganza@piacenza-demo.local',   pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_abbigl2,  'authenticated', 'authenticated', 'stile.urbano@piacenza-demo.local',        pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_casa1,    'authenticated', 'authenticated', 'casa.linda@piacenza-demo.local',          pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_casa2,    'authenticated', 'authenticated', 'cucina.plus@piacenza-demo.local',         pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_elettr1,  'authenticated', 'authenticated', 'techzone.piacenza@piacenza-demo.local',   pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_elettr2,  'authenticated', 'authenticated', 'smart.store@piacenza-demo.local',         pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_libri1,   'authenticated', 'authenticated', 'libreria.romana@piacenza-demo.local',     pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_libri2,   'authenticated', 'authenticated', 'cartoleria.centrale@piacenza-demo.local', pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_giard1,   'authenticated', 'authenticated', 'verde.casa@piacenza-demo.local',          pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_giard2,   'authenticated', 'authenticated', 'giardino.bello@piacenza-demo.local',      pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_bellez1,  'authenticated', 'authenticated', 'bellezza.naturale@piacenza-demo.local',   pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_bellez2,  'authenticated', 'authenticated', 'profumeria.charme@piacenza-demo.local',   pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_sport1,   'authenticated', 'authenticated', 'sportfit.piacenza@piacenza-demo.local',   pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false),
    ('00000000-0000-0000-0000-000000000000', s_sport2,   'authenticated', 'authenticated', 'outdoor.avventura@piacenza-demo.local',   pwd, now(), '{"provider":"email","providers":["email"]}', '{"role":"seller"}', now(), now(), false)
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------
  -- 2) Sicurezza: se per qualche motivo il trigger non ha creato il profilo
  --    (es. e' stato disabilitato), lo creiamo noi.
  ----------------------------------------------------------------
  INSERT INTO profiles (id, role, is_approved)
  SELECT u.id, 'seller', true
  FROM auth.users u
  WHERE u.email LIKE '%@piacenza-demo.local'
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id)
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------
  -- 3) Aggiorna i profili con dati negozio
  ----------------------------------------------------------------
  UPDATE profiles SET store_name='Salumeria del Borgo',   full_name='Salumeria del Borgo',   store_phone='0523123401', store_address='Via Calzolai 12, Piacenza',         store_lat=45.0498, store_lng=9.6968, role='seller', is_approved=true WHERE id=s_aliment1;
  UPDATE profiles SET store_name='Frutteto Verde',        full_name='Frutteto Verde',        store_phone='0523123402', store_address='Via XX Settembre 45, Piacenza',     store_lat=45.0541, store_lng=9.6892, role='seller', is_approved=true WHERE id=s_aliment2;
  UPDATE profiles SET store_name='Boutique Eleganza',     full_name='Boutique Eleganza',     store_phone='0523123403', store_address='Corso Vittorio Emanuele 22, Piacenza', store_lat=45.0517, store_lng=9.6951, role='seller', is_approved=true WHERE id=s_abbigl1;
  UPDATE profiles SET store_name='Stile Urbano',          full_name='Stile Urbano',          store_phone='0523123404', store_address='Via Garibaldi 18, Piacenza',        store_lat=45.0509, store_lng=9.6925, role='seller', is_approved=true WHERE id=s_abbigl2;
  UPDATE profiles SET store_name='Casa Linda',            full_name='Casa Linda',            store_phone='0523123405', store_address='Via Roma 56, Piacenza',             store_lat=45.0532, store_lng=9.6914, role='seller', is_approved=true WHERE id=s_casa1;
  UPDATE profiles SET store_name='Cucina Plus',           full_name='Cucina Plus',           store_phone='0523123406', store_address='Via Sopramuro 8, Piacenza',         store_lat=45.0489, store_lng=9.6940, role='seller', is_approved=true WHERE id=s_casa2;
  UPDATE profiles SET store_name='TechZone Piacenza',     full_name='TechZone Piacenza',     store_phone='0523123407', store_address='Via Mazzini 33, Piacenza',          store_lat=45.0521, store_lng=9.6973, role='seller', is_approved=true WHERE id=s_elettr1;
  UPDATE profiles SET store_name='Smart Store',           full_name='Smart Store',           store_phone='0523123408', store_address='Piazza Cavalli 5, Piacenza',        store_lat=45.0526, store_lng=9.6953, role='seller', is_approved=true WHERE id=s_elettr2;
  UPDATE profiles SET store_name='Libreria Romana',       full_name='Libreria Romana',       store_phone='0523123409', store_address='Via San Antonino 14, Piacenza',     store_lat=45.0501, store_lng=9.6960, role='seller', is_approved=true WHERE id=s_libri1;
  UPDATE profiles SET store_name='Cartoleria Centrale',   full_name='Cartoleria Centrale',   store_phone='0523123410', store_address='Via Cavour 27, Piacenza',           store_lat=45.0512, store_lng=9.6938, role='seller', is_approved=true WHERE id=s_libri2;
  UPDATE profiles SET store_name='Verde Casa',            full_name='Verde Casa',            store_phone='0523123411', store_address='Via Emilia Pavese 88, Piacenza',    store_lat=45.0445, store_lng=9.6788, role='seller', is_approved=true WHERE id=s_giard1;
  UPDATE profiles SET store_name='Giardino Bello',        full_name='Giardino Bello',        store_phone='0523123412', store_address='Strada Caorsana 102, Piacenza',     store_lat=45.0658, store_lng=9.7102, role='seller', is_approved=true WHERE id=s_giard2;
  UPDATE profiles SET store_name='Bellezza Naturale',     full_name='Bellezza Naturale',     store_phone='0523123413', store_address='Via Legnano 9, Piacenza',           store_lat=45.0489, store_lng=9.6892, role='seller', is_approved=true WHERE id=s_bellez1;
  UPDATE profiles SET store_name='Profumeria Charme',     full_name='Profumeria Charme',     store_phone='0523123414', store_address='Via Borghetto 11, Piacenza',        store_lat=45.0535, store_lng=9.6948, role='seller', is_approved=true WHERE id=s_bellez2;
  UPDATE profiles SET store_name='SportFit Piacenza',     full_name='SportFit Piacenza',     store_phone='0523123415', store_address='Via Manfredi 41, Piacenza',         store_lat=45.0561, store_lng=9.6991, role='seller', is_approved=true WHERE id=s_sport1;
  UPDATE profiles SET store_name='Outdoor Avventura',     full_name='Outdoor Avventura',     store_phone='0523123416', store_address='Strada Val Nure 15, Piacenza',      store_lat=45.0398, store_lng=9.7185, role='seller', is_approved=true WHERE id=s_sport2;

  ----------------------------------------------------------------
  -- 4) Prodotti (15 per negozio = 240 totali)
  ----------------------------------------------------------------
  -- Pulisci eventuali prodotti seed precedenti (per re-eseguibilita')
  DELETE FROM products WHERE seller_id IN (
    s_aliment1, s_aliment2, s_abbigl1, s_abbigl2,
    s_casa1, s_casa2, s_elettr1, s_elettr2,
    s_libri1, s_libri2, s_giard1, s_giard2,
    s_bellez1, s_bellez2, s_sport1, s_sport2
  );

  -- ALIMENTARI 1: Salumeria del Borgo
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_aliment1, c_aliment, 'Coppa piacentina DOP 200g',     'Coppa stagionata 6 mesi, sapore intenso e morbido.',           8.50,  'available', 30, '["https://placehold.co/400x400/fee2e2/dc2626?text=Coppa+DOP"]'::jsonb),
    (s_aliment1, c_aliment, 'Pancetta piacentina DOP 250g',  'Pancetta arrotolata, stagionatura tradizionale.',              7.20,  'available', 25, '["https://placehold.co/400x400/fee2e2/dc2626?text=Pancetta"]'::jsonb),
    (s_aliment1, c_aliment, 'Salame piacentino DOP 300g',    'Salame DOP, carne suina selezionata, stagionato 4 mesi.',      9.80,  'available', 40, '["https://placehold.co/400x400/fee2e2/dc2626?text=Salame"]'::jsonb),
    (s_aliment1, c_aliment, 'Grana Padano stagionato 1kg',   'Stagionatura 24 mesi, sapore deciso.',                         18.50, 'available', 15, '["https://placehold.co/400x400/fef3c7/d97706?text=Grana"]'::jsonb),
    (s_aliment1, c_aliment, 'Provolone Valpadana 500g',      'Provolone DOP dolce, ideale per panini.',                      6.90,  'available', 20, '["https://placehold.co/400x400/fef3c7/d97706?text=Provolone"]'::jsonb),
    (s_aliment1, c_aliment, 'Mortadella Bologna IGP 200g',   'Mortadella affettata fresca, ricetta tradizionale.',           5.20,  'available', 35, '["https://placehold.co/400x400/fee2e2/dc2626?text=Mortadella"]'::jsonb),
    (s_aliment1, c_aliment, 'Prosciutto crudo Parma 200g',   'Prosciutto di Parma DOP, stagionatura 18 mesi.',              11.00, 'available', 30, '["https://placehold.co/400x400/fee2e2/dc2626?text=Prosciutto"]'::jsonb),
    (s_aliment1, c_aliment, 'Bresaola della Valtellina 150g','Bresaola IGP, magra e saporita.',                              9.50,  'available', 22, '["https://placehold.co/400x400/fee2e2/dc2626?text=Bresaola"]'::jsonb),
    (s_aliment1, c_aliment, 'Pecorino Romano DOP 300g',      'Formaggio stagionato dal gusto deciso.',                       10.80, 'available', 18, '["https://placehold.co/400x400/fef3c7/d97706?text=Pecorino"]'::jsonb),
    (s_aliment1, c_aliment, 'Salame Milano 250g',            'Salame classico, grana fine, ottimo per antipasti.',           7.50,  'available', 28, '["https://placehold.co/400x400/fee2e2/dc2626?text=Salame+MI"]'::jsonb),
    (s_aliment1, c_aliment, 'Speck Alto Adige IGP 200g',     'Speck affumicato, sapore aromatico.',                          8.20,  'available', 24, '["https://placehold.co/400x400/fee2e2/dc2626?text=Speck"]'::jsonb),
    (s_aliment1, c_aliment, 'Stracchino 250g',               'Formaggio fresco cremoso, perfetto per la piadina.',           4.50,  'available', 40, '["https://placehold.co/400x400/fef3c7/d97706?text=Stracchino"]'::jsonb),
    (s_aliment1, c_aliment, 'Gorgonzola dolce DOP 300g',     'Gorgonzola dolce e cremoso, stagionatura 60 giorni.',          7.80,  'available', 20, '["https://placehold.co/400x400/fef3c7/d97706?text=Gorgonzola"]'::jsonb),
    (s_aliment1, c_aliment, 'Tortelli con la coda 500g',     'Pasta fresca ripiena di ricotta e spinaci.',                   6.90,  'available', 25, '["https://placehold.co/400x400/fef3c7/d97706?text=Tortelli"]'::jsonb),
    (s_aliment1, c_aliment, 'Anolini in brodo 500g',         'Pasta ripiena tradizionale piacentina.',                       7.20,  'available', 20, '["https://placehold.co/400x400/fef3c7/d97706?text=Anolini"]'::jsonb);

  -- ALIMENTARI 2: Frutteto Verde
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_aliment2, c_aliment, 'Pomodori ciliegino bio 500g',   'Pomodorini biologici, raccolti a mano nella pianura.',         3.80,  'available', 60, '["https://placehold.co/400x400/fee2e2/dc2626?text=Pomodori"]'::jsonb),
    (s_aliment2, c_aliment, 'Insalata mista bio 300g',       'Mix di insalate fresche bio, pronta da consumare.',            2.90,  'available', 50, '["https://placehold.co/400x400/dcfce7/16a34a?text=Insalata"]'::jsonb),
    (s_aliment2, c_aliment, 'Carote bio 1kg',                'Carote dolci e croccanti, coltivazione biologica.',            2.50,  'available', 80, '["https://placehold.co/400x400/fed7aa/ea580c?text=Carote"]'::jsonb),
    (s_aliment2, c_aliment, 'Patate novelle bio 2kg',        'Patate a buccia sottile, ideali al forno.',                    4.20,  'available', 45, '["https://placehold.co/400x400/fef3c7/d97706?text=Patate"]'::jsonb),
    (s_aliment2, c_aliment, 'Mele Golden bio 1kg',           'Mele dolci e succose, coltivate in Val di Non.',               3.50,  'available', 55, '["https://placehold.co/400x400/fef3c7/d97706?text=Mele"]'::jsonb),
    (s_aliment2, c_aliment, 'Banane biologiche 1kg',         'Banane equo-solidali bio, mature al punto giusto.',            2.80,  'available', 70, '["https://placehold.co/400x400/fef3c7/d97706?text=Banane"]'::jsonb),
    (s_aliment2, c_aliment, 'Arance siciliane 2kg',          'Arance tarocco bio dalla Sicilia, succose.',                   4.50,  'available', 40, '["https://placehold.co/400x400/fed7aa/ea580c?text=Arance"]'::jsonb),
    (s_aliment2, c_aliment, 'Limoni bio 500g',               'Limoni non trattati, ottimi per ricette e bibite.',            3.20,  'available', 35, '["https://placehold.co/400x400/fef3c7/d97706?text=Limoni"]'::jsonb),
    (s_aliment2, c_aliment, 'Zucchine bio 1kg',              'Zucchine fresche bio, raccolte di mattina.',                   3.40,  'available', 50, '["https://placehold.co/400x400/dcfce7/16a34a?text=Zucchine"]'::jsonb),
    (s_aliment2, c_aliment, 'Melanzane bio 1kg',             'Melanzane lunghe, polpa soda e saporita.',                     3.10,  'available', 40, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Melanzane"]'::jsonb),
    (s_aliment2, c_aliment, 'Peperoni misti bio 1kg',        'Peperoni rossi, gialli e verdi, bio.',                         4.20,  'available', 35, '["https://placehold.co/400x400/fee2e2/dc2626?text=Peperoni"]'::jsonb),
    (s_aliment2, c_aliment, 'Fragole bio 500g',              'Fragole dolci di stagione, profumate.',                        4.80,  'available', 30, '["https://placehold.co/400x400/fee2e2/dc2626?text=Fragole"]'::jsonb),
    (s_aliment2, c_aliment, 'Uva nera bio 1kg',              'Uva senza semi, polpa dolce.',                                 5.50,  'available', 25, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Uva"]'::jsonb),
    (s_aliment2, c_aliment, 'Pere Williams bio 1kg',         'Pere succose e profumate.',                                    3.90,  'available', 40, '["https://placehold.co/400x400/dcfce7/16a34a?text=Pere"]'::jsonb),
    (s_aliment2, c_aliment, 'Cipolle dolci bio 1kg',         'Cipolle dolci di Tropea bio.',                                 2.20,  'available', 60, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Cipolle"]'::jsonb);

  -- ABBIGLIAMENTO 1: Boutique Eleganza
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_abbigl1, c_abbigl, 'Vestito a fiori midi',          'Vestito leggero a fiori, ideale per primavera/estate.',          69.00,  'available', 15, '["https://placehold.co/400x400/fce7f3/db2777?text=Vestito"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Camicia di seta bianca',        'Camicia in seta 100%, taglio classico.',                         55.00,  'available', 20, '["https://placehold.co/400x400/e0e7ff/4f46e5?text=Camicia"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Pantaloni eleganti neri',       'Pantaloni a vita alta, tessuto stretch.',                        79.00,  'available', 18, '["https://placehold.co/400x400/1f2937/f9fafb?text=Pantaloni"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Giacca blazer beige',           'Blazer in misto lana, taglio sartoriale.',                       120.00, 'available', 12, '["https://placehold.co/400x400/fef3c7/d97706?text=Blazer"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Borsa a tracolla in pelle',     'Borsa in vera pelle italiana, vari colori.',                     89.00,  'available', 14, '["https://placehold.co/400x400/fed7aa/ea580c?text=Borsa"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Scarpe decollete tacco 7cm',    'Decollete classiche in vernice, comfort tutto il giorno.',       95.00,  'available', 16, '["https://placehold.co/400x400/1f2937/f9fafb?text=Scarpe"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Sciarpa di cashmere',           'Sciarpa morbidissima in cashmere puro.',                         45.00,  'available', 22, '["https://placehold.co/400x400/fce7f3/db2777?text=Sciarpa"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Maglione di lana merino',       'Maglione caldo in lana merino, vari colori.',                    68.00,  'available', 18, '["https://placehold.co/400x400/e0e7ff/4f46e5?text=Maglione"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Gonna midi a pieghe',           'Gonna midi elegante, plissettata.',                              52.00,  'available', 15, '["https://placehold.co/400x400/fce7f3/db2777?text=Gonna"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Cardigan in lana beige',        'Cardigan caldo, perfetto per le mezze stagioni.',                58.00,  'available', 16, '["https://placehold.co/400x400/fef3c7/d97706?text=Cardigan"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Cintura in pelle marrone',      'Cintura artigianale in vera pelle.',                             35.00,  'available', 25, '["https://placehold.co/400x400/fed7aa/ea580c?text=Cintura"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Cappello panama estivo',        'Cappello in paglia naturale, ideale per l estate.',              42.00,  'available', 12, '["https://placehold.co/400x400/fef3c7/d97706?text=Cappello"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Stivali alti in pelle',         'Stivali al ginocchio in vera pelle nera.',                       145.00, 'available', 10, '["https://placehold.co/400x400/1f2937/f9fafb?text=Stivali"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Pochette da sera glitter',      'Borsetta elegante per occasioni speciali.',                      65.00,  'available', 14, '["https://placehold.co/400x400/fce7f3/db2777?text=Pochette"]'::jsonb),
    (s_abbigl1, c_abbigl, 'Camicetta crepe bianca',        'Camicetta romantica con dettagli in pizzo.',                     45.00,  'available', 20, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Camicetta"]'::jsonb);

  -- ABBIGLIAMENTO 2: Stile Urbano
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_abbigl2, c_abbigl, 'T-shirt cotone bianca',         'T-shirt basic in cotone organico 100%.',                         19.50,  'available', 50, '["https://placehold.co/400x400/f3f4f6/4b5563?text=T-shirt"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Jeans slim fit denim scuro',    'Jeans slim, denim premium, comodi e resistenti.',                69.00,  'available', 30, '["https://placehold.co/400x400/1e3a8a/dbeafe?text=Jeans"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Felpa con cappuccio grigia',    'Felpa heavy-weight, interno felpato caldo.',                     49.00,  'available', 35, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Felpa"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Camicia button-down azzurra',   'Camicia casual in cotone Oxford.',                               55.00,  'available', 25, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Camicia"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Maglione girocollo navy',       'Maglione di lana, taglio regular.',                              58.00,  'available', 22, '["https://placehold.co/400x400/1e3a8a/dbeafe?text=Maglione"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Giubbino in pelle nera',        'Biker jacket in pelle vera, stile motociclista.',                189.00, 'available', 10, '["https://placehold.co/400x400/1f2937/f9fafb?text=Giubbino"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Pantaloni chino beige',         'Chino versatili, dal casual all elegante.',                      65.00,  'available', 28, '["https://placehold.co/400x400/fef3c7/d97706?text=Chino"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Sneakers bianche basic',        'Sneakers classiche, comode per ogni occasione.',                 89.00,  'available', 24, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Sneakers"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Boxer cotone pack 3',           'Boxer in cotone elasticizzato, multipack.',                      18.50,  'available', 60, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Boxer"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Calzini sportivi pack 6',       'Calzini lunghi in cotone, alta resistenza.',                     15.00,  'available', 80, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Calzini"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Cintura nera in cuoio',         'Cintura classica, fibbia in metallo.',                           29.00,  'available', 40, '["https://placehold.co/400x400/1f2937/f9fafb?text=Cintura"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Berretto invernale di lana',    'Beanie caldo, vari colori disponibili.',                         18.00,  'available', 45, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Berretto"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Polo pique blu navy',           'Polo classica in cotone pique.',                                 35.00,  'available', 32, '["https://placehold.co/400x400/1e3a8a/dbeafe?text=Polo"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Bermuda cargo estivi',          'Bermuda con tasconi, ideali per l estate.',                      38.00,  'available', 28, '["https://placehold.co/400x400/fef3c7/d97706?text=Bermuda"]'::jsonb),
    (s_abbigl2, c_abbigl, 'Cappotto invernale grigio',     'Cappotto lungo in lana, calore e stile.',                        165.00, 'available', 12, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Cappotto"]'::jsonb);

  -- CASA & CUCINA 1: Casa Linda
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_casa1, c_casa, 'Set lenzuola matrimoniali cotone', 'Lenzuola in puro cotone, alta densita di trama.',                 58.00,  'available', 25, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Lenzuola"]'::jsonb),
    (s_casa1, c_casa, 'Cuscino arredo 45x45 cm',          'Cuscino con fodera removibile e lavabile.',                       19.50,  'available', 40, '["https://placehold.co/400x400/fce7f3/db2777?text=Cuscino"]'::jsonb),
    (s_casa1, c_casa, 'Tovaglia in lino 8 persone',       'Tovaglia elegante in lino naturale.',                             45.00,  'available', 20, '["https://placehold.co/400x400/fef3c7/d97706?text=Tovaglia"]'::jsonb),
    (s_casa1, c_casa, 'Set 6 asciugamani spugna',         'Asciugamani 100% cotone, alta assorbenza.',                       38.00,  'available', 30, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Asciugamani"]'::jsonb),
    (s_casa1, c_casa, 'Coperta in pile matrimoniale',     'Coperta leggera e calda, vari colori.',                           28.00,  'available', 35, '["https://placehold.co/400x400/e0e7ff/4f46e5?text=Coperta"]'::jsonb),
    (s_casa1, c_casa, 'Tappeto soggiorno 160x230',        'Tappeto morbido, anti-scivolo.',                                  120.00, 'available', 12, '["https://placehold.co/400x400/fed7aa/ea580c?text=Tappeto"]'::jsonb),
    (s_casa1, c_casa, 'Tende oscuranti pack 2',           'Tende termiche, riduce luce e rumore.',                           55.00,  'available', 18, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Tende"]'::jsonb),
    (s_casa1, c_casa, 'Vaso decorativo ceramica',         'Vaso fatto a mano, design moderno.',                              32.00,  'available', 22, '["https://placehold.co/400x400/dcfce7/16a34a?text=Vaso"]'::jsonb),
    (s_casa1, c_casa, 'Cornice digitale 10 pollici',      'Cornice WiFi, app dedicata per inviare foto.',                    69.00,  'available', 15, '["https://placehold.co/400x400/1f2937/f9fafb?text=Cornice"]'::jsonb),
    (s_casa1, c_casa, 'Lampada da tavolo design',         'Lampada LED dimmerabile, base in marmo.',                         78.00,  'available', 10, '["https://placehold.co/400x400/fef3c7/d97706?text=Lampada"]'::jsonb),
    (s_casa1, c_casa, 'Plaid in lana 130x180',            'Plaid morbidissimo, perfetto sul divano.',                        45.00,  'available', 25, '["https://placehold.co/400x400/fed7aa/ea580c?text=Plaid"]'::jsonb),
    (s_casa1, c_casa, 'Set 4 tovaglioli lino',            'Tovaglioli lavabili, materiale naturale.',                        18.00,  'available', 40, '["https://placehold.co/400x400/fef3c7/d97706?text=Tovaglioli"]'::jsonb),
    (s_casa1, c_casa, 'Specchio decorativo rotondo',      'Specchio da parete, cornice in metallo.',                         58.00,  'available', 18, '["https://placehold.co/400x400/e0e7ff/4f46e5?text=Specchio"]'::jsonb),
    (s_casa1, c_casa, 'Centrotavola in vetro',            'Centrotavola elegante, vetro soffiato.',                          29.00,  'available', 20, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Centrotavola"]'::jsonb),
    (s_casa1, c_casa, 'Diffusore aromi a ultrasuoni',     'Diffusore con luce LED, capacita 200ml.',                         24.50,  'available', 30, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Diffusore"]'::jsonb);

  -- CASA & CUCINA 2: Cucina Plus
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_casa2, c_casa, 'Set pentole antiaderenti 5pz',     'Pentole con rivestimento eco, induzione compatibili.',            98.00,  'available', 20, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Pentole"]'::jsonb),
    (s_casa2, c_casa, 'Set 12 posate inox',               'Posate in acciaio inox 18/10, lavastoviglie.',                    38.00,  'available', 30, '["https://placehold.co/400x400/e5e7eb/374151?text=Posate"]'::jsonb),
    (s_casa2, c_casa, 'Padella ferro 28cm',               'Padella ferro pesante, ideale per cottura ad alta T.',            42.00,  'available', 18, '["https://placehold.co/400x400/1f2937/f9fafb?text=Padella"]'::jsonb),
    (s_casa2, c_casa, 'Macchina caffe espresso',          'Macchina con pompa 15 bar, capsule compatibili.',                 145.00, 'available', 10, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Caffe"]'::jsonb),
    (s_casa2, c_casa, 'Frullatore 600W',                  'Frullatore con caraffa in vetro, 4 velocita.',                    65.00,  'available', 15, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Frullatore"]'::jsonb),
    (s_casa2, c_casa, 'Set 6 bicchieri vino',             'Calici in vetro cristallino, design classico.',                   28.00,  'available', 25, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Bicchieri"]'::jsonb),
    (s_casa2, c_casa, 'Caraffa filtrante 2.5L',           'Filtra calcare e cloro, ricariche compatibili.',                  32.00,  'available', 22, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Caraffa"]'::jsonb),
    (s_casa2, c_casa, 'Tritatutto elettrico 500ml',       'Tritatutto compatto, lama in acciaio.',                           48.00,  'available', 18, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Tritatutto"]'::jsonb),
    (s_casa2, c_casa, 'Bilancia da cucina digitale',      'Precisione 1g, capacita fino a 5kg.',                             19.50,  'available', 35, '["https://placehold.co/400x400/e5e7eb/374151?text=Bilancia"]'::jsonb),
    (s_casa2, c_casa, 'Spremiagrumi elettrico',           'Spremiagrumi automatico, doppio cono.',                           35.00,  'available', 20, '["https://placehold.co/400x400/fed7aa/ea580c?text=Spremiagrumi"]'::jsonb),
    (s_casa2, c_casa, 'Set tegami in vetro 3pz',          'Tegami pyrex, forno e microonde compatibili.',                    28.00,  'available', 25, '["https://placehold.co/400x400/e5e7eb/374151?text=Tegami"]'::jsonb),
    (s_casa2, c_casa, 'Coltelli da cucina set 5pz',       'Coltelli in acciaio inox con manico ergonomico.',                 58.00,  'available', 15, '["https://placehold.co/400x400/1f2937/f9fafb?text=Coltelli"]'::jsonb),
    (s_casa2, c_casa, 'Tagliere bambu grande',            'Tagliere ecologico, resistente, antibatterico.',                  18.00,  'available', 40, '["https://placehold.co/400x400/fef3c7/d97706?text=Tagliere"]'::jsonb),
    (s_casa2, c_casa, 'Macinacaffe manuale',              'Macinacaffe in legno con macina ceramica.',                       25.00,  'available', 22, '["https://placehold.co/400x400/fed7aa/ea580c?text=Macinacaffe"]'::jsonb),
    (s_casa2, c_casa, 'Tostapane 2 fette',                'Tostapane con 6 livelli di doratura.',                            32.00,  'available', 18, '["https://placehold.co/400x400/e5e7eb/374151?text=Tostapane"]'::jsonb);

  -- ELETTRONICA 1: TechZone Piacenza
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_elettr1, c_elettr, 'Cuffie Bluetooth wireless',      'Cuffie over-ear con ANC, autonomia 30h.',                       58.00,  'available', 25, '["https://placehold.co/400x400/1f2937/f9fafb?text=Cuffie"]'::jsonb),
    (s_elettr1, c_elettr, 'Caricabatterie USB-C 20W',       'Caricatore rapido GaN, USB-C PD.',                              18.00,  'available', 50, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Caricatore"]'::jsonb),
    (s_elettr1, c_elettr, 'Powerbank 10000mAh',             'Powerbank con USB-C e ricarica rapida.',                        25.00,  'available', 40, '["https://placehold.co/400x400/1f2937/f9fafb?text=Powerbank"]'::jsonb),
    (s_elettr1, c_elettr, 'Cavo USB-C 2m intrecciato',      'Cavo resistente, supporta ricarica rapida.',                    12.00,  'available', 80, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Cavo"]'::jsonb),
    (s_elettr1, c_elettr, 'Mouse wireless ergonomico',      'Mouse verticale, riduce affaticamento polso.',                  28.00,  'available', 30, '["https://placehold.co/400x400/1f2937/f9fafb?text=Mouse"]'::jsonb),
    (s_elettr1, c_elettr, 'Tastiera meccanica RGB',         'Switch blu, retroilluminazione personalizzabile.',              78.00,  'available', 15, '["https://placehold.co/400x400/1f2937/f9fafb?text=Tastiera"]'::jsonb),
    (s_elettr1, c_elettr, 'Webcam HD 1080p',                'Webcam con autofocus, microfono integrato.',                    45.00,  'available', 20, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Webcam"]'::jsonb),
    (s_elettr1, c_elettr, 'Speaker bluetooth portatile',    'Speaker waterproof, 12h autonomia.',                            38.00,  'available', 22, '["https://placehold.co/400x400/1f2937/f9fafb?text=Speaker"]'::jsonb),
    (s_elettr1, c_elettr, 'Hub USB 4 porte',                'Hub USB 3.0, alimentazione esterna opzionale.',                 19.00,  'available', 35, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Hub+USB"]'::jsonb),
    (s_elettr1, c_elettr, 'Adattatore HDMI 4K',             'Adattatore HDMI a VGA/DVI, supporta 4K.',                       15.00,  'available', 40, '["https://placehold.co/400x400/4b5563/f3f4f6?text=HDMI"]'::jsonb),
    (s_elettr1, c_elettr, 'SSD esterno 500GB',              'SSD USB-C, trasferimento fino a 540MB/s.',                      68.00,  'available', 18, '["https://placehold.co/400x400/1f2937/f9fafb?text=SSD"]'::jsonb),
    (s_elettr1, c_elettr, 'Lampada LED con USB',            'Lampada da scrivania con porta USB integrata.',                 22.00,  'available', 30, '["https://placehold.co/400x400/fef3c7/d97706?text=Lampada"]'::jsonb),
    (s_elettr1, c_elettr, 'Stand per laptop alluminio',     'Supporto regolabile in altezza, raffreddamento.',               28.00,  'available', 25, '["https://placehold.co/400x400/e5e7eb/374151?text=Stand"]'::jsonb),
    (s_elettr1, c_elettr, 'Microfono USB streaming',        'Microfono cardioide, ideale per podcast e gaming.',             58.00,  'available', 15, '["https://placehold.co/400x400/1f2937/f9fafb?text=Microfono"]'::jsonb),
    (s_elettr1, c_elettr, 'Pad mouse XL gaming',            'Tappetino esteso 90x40cm, base antiscivolo.',                   18.00,  'available', 45, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Pad"]'::jsonb);

  -- ELETTRONICA 2: Smart Store
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_elettr2, c_elettr, 'Cover iPhone trasparente',       'Cover antiurto, compatibile con MagSafe.',                      15.00,  'available', 60, '["https://placehold.co/400x400/e5e7eb/374151?text=Cover+iPhone"]'::jsonb),
    (s_elettr2, c_elettr, 'Cover Samsung silicone',         'Cover morbida, vari colori disponibili.',                       13.00,  'available', 55, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Cover+Samsung"]'::jsonb),
    (s_elettr2, c_elettr, 'Pellicola vetro temperato',      'Protezione schermo 9H, applicazione facile.',                   9.50,   'available', 100,'["https://placehold.co/400x400/f3f4f6/4b5563?text=Vetro"]'::jsonb),
    (s_elettr2, c_elettr, 'Auricolari true wireless',       'Auricolari TWS con custodia di ricarica.',                      45.00,  'available', 35, '["https://placehold.co/400x400/1f2937/f9fafb?text=Auricolari"]'::jsonb),
    (s_elettr2, c_elettr, 'Smartwatch fitness',             'Smartwatch con cardiofrequenzimetro, IP68.',                    58.00,  'available', 25, '["https://placehold.co/400x400/1f2937/f9fafb?text=Smartwatch"]'::jsonb),
    (s_elettr2, c_elettr, 'Caricatore wireless 15W',        'Caricatore Qi, supporto iPhone/Android.',                       28.00,  'available', 30, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Wireless"]'::jsonb),
    (s_elettr2, c_elettr, 'Adattatore Lightning a jack',    'Adattatore audio per iPhone, MFI certificato.',                 18.00,  'available', 45, '["https://placehold.co/400x400/e5e7eb/374151?text=Lightning"]'::jsonb),
    (s_elettr2, c_elettr, 'Cavo Lightning 2m',              'Cavo certificato MFI, intrecciato.',                            15.00,  'available', 70, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Lightning+2m"]'::jsonb),
    (s_elettr2, c_elettr, 'Supporto smartphone auto',       'Supporto magnetico per auto, rotazione 360.',                   19.00,  'available', 40, '["https://placehold.co/400x400/1f2937/f9fafb?text=Supporto"]'::jsonb),
    (s_elettr2, c_elettr, 'Selfie stick con treppiede',     'Selfie stick estensibile fino 1.4m, telecomando.',              22.00,  'available', 28, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Selfie"]'::jsonb),
    (s_elettr2, c_elettr, 'Anello luminoso 10 pollici',     'Ring light con treppiede, 3 temperature colore.',               35.00,  'available', 20, '["https://placehold.co/400x400/fef3c7/d97706?text=Ring"]'::jsonb),
    (s_elettr2, c_elettr, 'Caricatore auto USB-C 45W',      'Caricatore PD, doppia porta USB-C.',                            19.00,  'available', 35, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Auto"]'::jsonb),
    (s_elettr2, c_elettr, 'Memory card microSD 64GB',       'Scheda Classe 10, fino a 100MB/s.',                             15.00,  'available', 50, '["https://placehold.co/400x400/4b5563/f3f4f6?text=MicroSD"]'::jsonb),
    (s_elettr2, c_elettr, 'Bracciale fitness sport',        'Tracker con notifiche, monitor sonno.',                         38.00,  'available', 30, '["https://placehold.co/400x400/1f2937/f9fafb?text=Bracciale"]'::jsonb),
    (s_elettr2, c_elettr, 'Custodia AirPods silicone',      'Custodia protettiva con moschettone.',                          18.00,  'available', 45, '["https://placehold.co/400x400/e5e7eb/374151?text=AirPods"]'::jsonb);

  -- LIBRI 1: Libreria Romana
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_libri1, c_libri, 'Romanzo italiano contemporaneo',  'Bestseller della narrativa italiana 2025.',                      18.00,  'available', 20, '["https://placehold.co/400x400/dcfce7/16a34a?text=Romanzo"]'::jsonb),
    (s_libri1, c_libri, 'Storia di Piacenza',              'Saggio sulla storia della citta dal medioevo.',                  22.00,  'available', 15, '["https://placehold.co/400x400/dcfce7/16a34a?text=Storia+PC"]'::jsonb),
    (s_libri1, c_libri, 'Libro per bambini illustrato',    'Storia per bambini 4-7 anni, illustrazioni a colori.',           14.50,  'available', 25, '["https://placehold.co/400x400/fce7f3/db2777?text=Bambini"]'::jsonb),
    (s_libri1, c_libri, 'Guida Emilia-Romagna',            'Guida turistica completa con itinerari.',                        15.00,  'available', 18, '["https://placehold.co/400x400/fef3c7/d97706?text=Guida"]'::jsonb),
    (s_libri1, c_libri, 'I promessi sposi - Manzoni',      'Classico della letteratura italiana, edizione integrale.',       12.00,  'available', 30, '["https://placehold.co/400x400/dcfce7/16a34a?text=Manzoni"]'::jsonb),
    (s_libri1, c_libri, 'Biografia di Leonardo',           'Biografia di Leonardo da Vinci, riccamente illustrata.',         19.00,  'available', 18, '["https://placehold.co/400x400/fef3c7/d97706?text=Leonardo"]'::jsonb),
    (s_libri1, c_libri, 'Cucina italiana di base',         'Ricette tradizionali regione per regione.',                      24.00,  'available', 22, '["https://placehold.co/400x400/fee2e2/dc2626?text=Cucina"]'::jsonb),
    (s_libri1, c_libri, 'Raccolta poesie Montale',         'Antologia delle poesie di Eugenio Montale.',                     13.50,  'available', 20, '["https://placehold.co/400x400/dcfce7/16a34a?text=Poesie"]'::jsonb),
    (s_libri1, c_libri, 'Romanzo giallo Camilleri',        'Le indagini del Commissario Montalbano.',                        16.00,  'available', 28, '["https://placehold.co/400x400/1f2937/f9fafb?text=Giallo"]'::jsonb),
    (s_libri1, c_libri, 'Manuale di fotografia',           'Guida completa alla fotografia digitale.',                       28.00,  'available', 15, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Fotografia"]'::jsonb),
    (s_libri1, c_libri, 'Dizionario Italiano Zingarelli',  'Dizionario aggiornato 2025, oltre 145.000 voci.',                25.00,  'available', 12, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Dizionario"]'::jsonb),
    (s_libri1, c_libri, 'Atlante geografico mondo',        'Atlante illustrato con cartine politiche e fisiche.',            32.00,  'available', 10, '["https://placehold.co/400x400/dcfce7/16a34a?text=Atlante"]'::jsonb),
    (s_libri1, c_libri, 'Arte del Rinascimento',           'Storia dell arte rinascimentale italiana.',                      38.00,  'available', 12, '["https://placehold.co/400x400/fef3c7/d97706?text=Arte"]'::jsonb),
    (s_libri1, c_libri, 'Informatica base per tutti',      'Manuale introduttivo a computer e Internet.',                    22.00,  'available', 18, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Informatica"]'::jsonb),
    (s_libri1, c_libri, 'Manuale di giardinaggio',         'Tecniche e consigli per il giardino di casa.',                   18.50,  'available', 20, '["https://placehold.co/400x400/dcfce7/16a34a?text=Giardino"]'::jsonb);

  -- LIBRI 2: Cartoleria Centrale
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_libri2, c_libri, 'Quaderni A4 a righe pack 5',     'Quaderni 80 pagine, copertina rinforzata.',                       8.00,   'available', 80, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Quaderni"]'::jsonb),
    (s_libri2, c_libri, 'Penne biro pack 12',             'Penne sfera blu, scrittura fluida.',                              6.50,   'available', 100,'["https://placehold.co/400x400/1e3a8a/dbeafe?text=Penne"]'::jsonb),
    (s_libri2, c_libri, 'Matite HB pack 12',              'Matite di qualita, gomma integrata.',                             4.50,   'available', 120,'["https://placehold.co/400x400/fef3c7/d97706?text=Matite"]'::jsonb),
    (s_libri2, c_libri, 'Astuccio scolastico 3 cerniere', 'Astuccio capiente, vari colori.',                                 15.00,  'available', 40, '["https://placehold.co/400x400/fce7f3/db2777?text=Astuccio"]'::jsonb),
    (s_libri2, c_libri, 'Zaino scuola medio',             'Zaino con scomparti multipli, schienale ergonomico.',             38.00,  'available', 30, '["https://placehold.co/400x400/1e3a8a/dbeafe?text=Zaino"]'::jsonb),
    (s_libri2, c_libri, 'Risma carta A4 500 fogli',       'Carta bianca 80g, ideale per stampa.',                            5.50,   'available', 70, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Risma"]'::jsonb),
    (s_libri2, c_libri, 'Forbici scolastiche punte tonde','Forbici sicure per bambini.',                                     3.50,   'available', 60, '["https://placehold.co/400x400/dcfce7/16a34a?text=Forbici"]'::jsonb),
    (s_libri2, c_libri, 'Colla stick maxi pack 3',        'Colla in stick, atossica.',                                       4.20,   'available', 80, '["https://placehold.co/400x400/fef3c7/d97706?text=Colla"]'::jsonb),
    (s_libri2, c_libri, 'Pennarelli colorati pack 24',    'Pennarelli punta media, colori brillanti.',                       12.00,  'available', 45, '["https://placehold.co/400x400/fce7f3/db2777?text=Pennarelli"]'::jsonb),
    (s_libri2, c_libri, 'Pastelli a cera pack 12',        'Pastelli morbidi, ideali per bambini piccoli.',                   5.00,   'available', 65, '["https://placehold.co/400x400/fed7aa/ea580c?text=Pastelli"]'::jsonb),
    (s_libri2, c_libri, 'Agenda 2026 settimanale',        'Agenda con calendario, planner mensile.',                         15.00,  'available', 25, '["https://placehold.co/400x400/1f2937/f9fafb?text=Agenda"]'::jsonb),
    (s_libri2, c_libri, 'Cartelletta archivio A4',        'Cartella con elastico, capacita 200 fogli.',                      8.50,   'available', 50, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Cartella"]'::jsonb),
    (s_libri2, c_libri, 'Calcolatrice scientifica',       'Calcolatrice 240 funzioni, ideale per scuola.',                   22.00,  'available', 20, '["https://placehold.co/400x400/1f2937/f9fafb?text=Calcolatrice"]'::jsonb),
    (s_libri2, c_libri, 'Set righelli e squadre',         'Set con righello 30cm, squadre e goniometro.',                    6.50,   'available', 55, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Righelli"]'::jsonb),
    (s_libri2, c_libri, 'Album da disegno A3',            'Album 50 fogli, carta da disegno 200g.',                          9.00,   'available', 35, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Album"]'::jsonb);

  -- GIARDINO 1: Verde Casa
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_giard1, c_giard, 'Pianta basilico in vaso',         'Basilico aromatico fresco, vaso 14cm.',                          5.00,   'available', 50, '["https://placehold.co/400x400/dcfce7/16a34a?text=Basilico"]'::jsonb),
    (s_giard1, c_giard, 'Pianta rosmarino aromatica',     'Rosmarino in vaso, perfetto per cucina e balcone.',               6.50,   'available', 40, '["https://placehold.co/400x400/dcfce7/16a34a?text=Rosmarino"]'::jsonb),
    (s_giard1, c_giard, 'Orchidea Phalaenopsis',          'Orchidea fiorita, fiori bianchi o rosa.',                         18.00,  'available', 25, '["https://placehold.co/400x400/fce7f3/db2777?text=Orchidea"]'::jsonb),
    (s_giard1, c_giard, 'Cactus mix 3 piante',            'Composizione di 3 cactus in vasi decorativi.',                    15.00,  'available', 30, '["https://placehold.co/400x400/dcfce7/16a34a?text=Cactus"]'::jsonb),
    (s_giard1, c_giard, 'Bonsai ginepro 5 anni',          'Bonsai gia formato, vaso ceramica incluso.',                      45.00,  'available', 12, '["https://placehold.co/400x400/dcfce7/16a34a?text=Bonsai"]'::jsonb),
    (s_giard1, c_giard, 'Semi pomodoro bio',              'Bustina semi 50pz, varieta cuore di bue.',                        3.50,   'available', 80, '["https://placehold.co/400x400/fee2e2/dc2626?text=Semi+Pom"]'::jsonb),
    (s_giard1, c_giard, 'Semi insalata mista',            'Mix di varieta, semi biologici.',                                 2.80,   'available', 90, '["https://placehold.co/400x400/dcfce7/16a34a?text=Semi+Ins"]'::jsonb),
    (s_giard1, c_giard, 'Vaso terracotta 25cm',           'Vaso classico in terracotta, foro drenaggio.',                    12.00,  'available', 40, '["https://placehold.co/400x400/fed7aa/ea580c?text=Vaso"]'::jsonb),
    (s_giard1, c_giard, 'Terriccio universale 20L',       'Terriccio arricchito, ideale per ogni pianta.',                   8.50,   'available', 35, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Terriccio"]'::jsonb),
    (s_giard1, c_giard, 'Fertilizzante liquido 500ml',    'Concime universale per piante da appartamento.',                  9.00,   'available', 45, '["https://placehold.co/400x400/dcfce7/16a34a?text=Concime"]'::jsonb),
    (s_giard1, c_giard, 'Aloe vera in vaso',              'Pianta aloe matura, perfetta per la casa.',                       12.00,  'available', 28, '["https://placehold.co/400x400/dcfce7/16a34a?text=Aloe"]'::jsonb),
    (s_giard1, c_giard, 'Ficus benjamin medio',           'Pianta da interno alta circa 80cm.',                              28.00,  'available', 18, '["https://placehold.co/400x400/dcfce7/16a34a?text=Ficus"]'::jsonb),
    (s_giard1, c_giard, 'Lavanda profumata in vaso',      'Lavanda fiorita, profumo intenso.',                               9.50,   'available', 35, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Lavanda"]'::jsonb),
    (s_giard1, c_giard, 'Pianta menta in vaso',           'Menta piperita aromatica, vaso 14cm.',                            5.50,   'available', 40, '["https://placehold.co/400x400/dcfce7/16a34a?text=Menta"]'::jsonb),
    (s_giard1, c_giard, 'Succulenta decorativa',          'Succulenta in vaso ceramico, varieta assortite.',                 8.00,   'available', 50, '["https://placehold.co/400x400/dcfce7/16a34a?text=Succulenta"]'::jsonb);

  -- GIARDINO 2: Giardino Bello
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_giard2, c_giard, 'Forbici da potatura professionali','Forbici con lame acciaio temprato, manici ergonomici.',         18.00,  'available', 35, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Forbici"]'::jsonb),
    (s_giard2, c_giard, 'Vanga con manico in legno',       'Vanga robusta, manico in frassino.',                              25.00,  'available', 20, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Vanga"]'::jsonb),
    (s_giard2, c_giard, 'Tubo gomma 25m',                  'Tubo flessibile anti-piega, raccordi inclusi.',                   38.00,  'available', 18, '["https://placehold.co/400x400/dcfce7/16a34a?text=Tubo"]'::jsonb),
    (s_giard2, c_giard, 'Annaffiatoio 10L',                'Annaffiatoio in plastica resistente.',                            12.50,  'available', 30, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Annaffiatoio"]'::jsonb),
    (s_giard2, c_giard, 'Guanti giardinaggio gomma',       'Guanti impermeabili, taglia M-L.',                                6.50,   'available', 60, '["https://placehold.co/400x400/dcfce7/16a34a?text=Guanti"]'::jsonb),
    (s_giard2, c_giard, 'Set attrezzi 5 pezzi',            'Paletta, rastrello, sarchiatore, cesoie, guanti.',                28.00,  'available', 22, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Set+Attr"]'::jsonb),
    (s_giard2, c_giard, 'Cassetta legno per fiori',        'Fioriera in legno trattato 60cm.',                                22.00,  'available', 25, '["https://placehold.co/400x400/fed7aa/ea580c?text=Fioriera"]'::jsonb),
    (s_giard2, c_giard, 'Rete ombreggiante 3x5m',          'Rete tessuta verde, 70% ombreggiamento.',                         18.00,  'available', 28, '["https://placehold.co/400x400/dcfce7/16a34a?text=Rete"]'::jsonb),
    (s_giard2, c_giard, 'Concime granulare 2kg',           'Concime universale a lenta cessione.',                            11.00,  'available', 35, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Concime"]'::jsonb),
    (s_giard2, c_giard, 'Trappola insetti adesiva',        'Trappola gialla per insetti volanti, pack 10.',                   8.50,   'available', 40, '["https://placehold.co/400x400/fef3c7/d97706?text=Trappola"]'::jsonb),
    (s_giard2, c_giard, 'Tagliasiepi elettrico 500W',      'Tagliasiepi con lama 50cm, leggero e potente.',                   78.00,  'available', 15, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Tagliasiepi"]'::jsonb),
    (s_giard2, c_giard, 'Soffiatore foglie elettrico',     'Soffiatore 1800W, raccoglie e tritura.',                          58.00,  'available', 18, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Soffiatore"]'::jsonb),
    (s_giard2, c_giard, 'Sacchi raccolta 100L pack 5',     'Sacchi per scarti vegetali, resistenti.',                         9.00,   'available', 50, '["https://placehold.co/400x400/dcfce7/16a34a?text=Sacchi"]'::jsonb),
    (s_giard2, c_giard, 'Decespugliatore manuale',         'Decespugliatore a batteria, leggero.',                            42.00,  'available', 20, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Decespugliatore"]'::jsonb),
    (s_giard2, c_giard, 'Carriola 80L',                    'Carriola in lamiera zincata, ruota pneumatica.',                  68.00,  'available', 12, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Carriola"]'::jsonb);

  -- BELLEZZA 1: Bellezza Naturale
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_bellez1, c_bellez, 'Crema viso bio 50ml',            'Crema idratante con acido ialuronico naturale.',                 22.00,  'available', 30, '["https://placehold.co/400x400/fce7f3/db2777?text=Crema+Viso"]'::jsonb),
    (s_bellez1, c_bellez, 'Olio di argan 100ml',            'Olio puro 100%, per capelli e pelle.',                           18.00,  'available', 35, '["https://placehold.co/400x400/fef3c7/d97706?text=Argan"]'::jsonb),
    (s_bellez1, c_bellez, 'Shampoo naturale 250ml',         'Shampoo delicato senza solfati.',                                12.50,  'available', 50, '["https://placehold.co/400x400/dcfce7/16a34a?text=Shampoo"]'::jsonb),
    (s_bellez1, c_bellez, 'Balsamo riparatore 200ml',       'Balsamo per capelli sfibrati, bio.',                             11.00,  'available', 45, '["https://placehold.co/400x400/dcfce7/16a34a?text=Balsamo"]'::jsonb),
    (s_bellez1, c_bellez, 'Bagno schiuma bio 500ml',        'Bagno schiuma vegetale, fragranza lavanda.',                     9.50,   'available', 55, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Bagnoschiuma"]'::jsonb),
    (s_bellez1, c_bellez, 'Crema mani avocado 75ml',        'Crema mani idratante con burro di avocado.',                     8.00,   'available', 60, '["https://placehold.co/400x400/dcfce7/16a34a?text=Mani"]'::jsonb),
    (s_bellez1, c_bellez, 'Maschera viso argilla 100g',     'Maschera purificante all argilla verde.',                        15.00,  'available', 40, '["https://placehold.co/400x400/dcfce7/16a34a?text=Maschera"]'::jsonb),
    (s_bellez1, c_bellez, 'Tonico viso bio 200ml',          'Tonico astringente per pelli miste.',                            14.00,  'available', 38, '["https://placehold.co/400x400/fce7f3/db2777?text=Tonico"]'::jsonb),
    (s_bellez1, c_bellez, 'Crema corpo idratante 250ml',    'Crema nutriente con karite.',                                    16.50,  'available', 42, '["https://placehold.co/400x400/fef3c7/d97706?text=Corpo"]'::jsonb),
    (s_bellez1, c_bellez, 'Olio essenziale lavanda 10ml',   'Olio puro per aromaterapia.',                                    8.00,   'available', 50, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Lavanda"]'::jsonb),
    (s_bellez1, c_bellez, 'Burro di karite puro 100g',      'Burro 100% puro non raffinato.',                                 12.00,  'available', 35, '["https://placehold.co/400x400/fef3c7/d97706?text=Karite"]'::jsonb),
    (s_bellez1, c_bellez, 'Spazzola in legno naturale',     'Spazzola con setole naturali.',                                  18.00,  'available', 30, '["https://placehold.co/400x400/fed7aa/ea580c?text=Spazzola"]'::jsonb),
    (s_bellez1, c_bellez, 'Detergente viso bio 150ml',      'Mousse detergente delicata.',                                    13.50,  'available', 40, '["https://placehold.co/400x400/dcfce7/16a34a?text=Detergente"]'::jsonb),
    (s_bellez1, c_bellez, 'Crema solare SPF50 100ml',       'Protezione alta, resistente all acqua.',                         19.00,  'available', 45, '["https://placehold.co/400x400/fef3c7/d97706?text=Solare"]'::jsonb),
    (s_bellez1, c_bellez, 'Scrub corpo zucchero 300g',      'Scrub esfoliante con olii naturali.',                            15.50,  'available', 35, '["https://placehold.co/400x400/fce7f3/db2777?text=Scrub"]'::jsonb);

  -- BELLEZZA 2: Profumeria Charme
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_bellez2, c_bellez, 'Profumo donna floreale 50ml',    'Eau de parfum, note di gelsomino e rosa.',                       68.00,  'available', 20, '["https://placehold.co/400x400/fce7f3/db2777?text=Profumo+D"]'::jsonb),
    (s_bellez2, c_bellez, 'Profumo uomo legno 100ml',       'Eau de toilette, note legnose e speziate.',                      78.00,  'available', 18, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Profumo+U"]'::jsonb),
    (s_bellez2, c_bellez, 'Rossetto rosso classico',        'Rossetto matte lunga durata.',                                   18.00,  'available', 40, '["https://placehold.co/400x400/dc2626/fee2e2?text=Rossetto"]'::jsonb),
    (s_bellez2, c_bellez, 'Mascara volumizzante',           'Mascara per ciglia voluminose, nero intenso.',                   22.00,  'available', 35, '["https://placehold.co/400x400/1f2937/f9fafb?text=Mascara"]'::jsonb),
    (s_bellez2, c_bellez, 'Palette ombretti 12 colori',     'Palette nude, finiture matte e shimmer.',                        38.00,  'available', 25, '["https://placehold.co/400x400/fed7aa/ea580c?text=Palette"]'::jsonb),
    (s_bellez2, c_bellez, 'Smalto rosso lucido',            'Smalto a effetto specchio, lunga tenuta.',                       12.00,  'available', 50, '["https://placehold.co/400x400/dc2626/fee2e2?text=Smalto"]'::jsonb),
    (s_bellez2, c_bellez, 'Fondotinta liquido medio',       'Fondotinta coprente, finish naturale.',                          28.00,  'available', 30, '["https://placehold.co/400x400/fed7aa/ea580c?text=Fondotinta"]'::jsonb),
    (s_bellez2, c_bellez, 'Cipria opacizzante',             'Cipria translucida, controlla la lucidita.',                     19.00,  'available', 35, '["https://placehold.co/400x400/fef3c7/d97706?text=Cipria"]'::jsonb),
    (s_bellez2, c_bellez, 'Eyeliner liquido nero',          'Eyeliner a penna, tratto preciso.',                              15.00,  'available', 45, '["https://placehold.co/400x400/1f2937/f9fafb?text=Eyeliner"]'::jsonb),
    (s_bellez2, c_bellez, 'Matita labbra nude',             'Matita morbida, colore versatile.',                              12.50,  'available', 40, '["https://placehold.co/400x400/fed7aa/ea580c?text=Matita"]'::jsonb),
    (s_bellez2, c_bellez, 'Profumo unisex 30ml',            'Eau de parfum fresco e moderno.',                                45.00,  'available', 22, '["https://placehold.co/400x400/e0e7ff/4f46e5?text=Unisex"]'::jsonb),
    (s_bellez2, c_bellez, 'Crema antieta notte 50ml',       'Crema notte con retinolo e peptidi.',                            58.00,  'available', 20, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Antieta"]'::jsonb),
    (s_bellez2, c_bellez, 'Siero vitamina C 30ml',          'Siero illuminante, attenua macchie.',                            38.00,  'available', 25, '["https://placehold.co/400x400/fef3c7/d97706?text=Vit+C"]'::jsonb),
    (s_bellez2, c_bellez, 'Eau de toilette 200ml',          'Profumo da corpo nebulizzato.',                                  38.00,  'available', 28, '["https://placehold.co/400x400/fce7f3/db2777?text=Toilette"]'::jsonb),
    (s_bellez2, c_bellez, 'Set make-up base 5pz',           'Kit con fondotinta, cipria, mascara e rossetti.',                58.00,  'available', 15, '["https://placehold.co/400x400/fce7f3/db2777?text=Set+MU"]'::jsonb);

  -- SPORT 1: SportFit Piacenza
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_sport1, c_sport, 'Tappetino yoga antiscivolo',       'Tappetino 6mm, materiale eco-friendly.',                         25.00,  'available', 30, '["https://placehold.co/400x400/e9d5ff/9333ea?text=Yoga+Mat"]'::jsonb),
    (s_sport1, c_sport, 'Manubri 5kg coppia',               'Manubri in ghisa rivestiti, presa antiscivolo.',                 38.00,  'available', 25, '["https://placehold.co/400x400/1f2937/f9fafb?text=Manubri"]'::jsonb),
    (s_sport1, c_sport, 'Bilanciere fitness regolabile',    'Bilanciere con pesi intercambiabili, 30kg totali.',              78.00,  'available', 15, '["https://placehold.co/400x400/1f2937/f9fafb?text=Bilanciere"]'::jsonb),
    (s_sport1, c_sport, 'Tuta ginnastica donna',            'Tuta sportiva traspirante, taglie XS-XL.',                       58.00,  'available', 28, '["https://placehold.co/400x400/fce7f3/db2777?text=Tuta+D"]'::jsonb),
    (s_sport1, c_sport, 'Tuta ginnastica uomo',             'Tuta sportiva traspirante, taglie S-XXL.',                       58.00,  'available', 28, '["https://placehold.co/400x400/1e3a8a/dbeafe?text=Tuta+U"]'::jsonb),
    (s_sport1, c_sport, 'Scarpe running uomo',              'Scarpe leggere con ammortizzazione, taglie 40-46.',              89.00,  'available', 22, '["https://placehold.co/400x400/1f2937/f9fafb?text=Run+U"]'::jsonb),
    (s_sport1, c_sport, 'Scarpe running donna',             'Scarpe leggere con ammortizzazione, taglie 36-41.',              89.00,  'available', 22, '["https://placehold.co/400x400/fce7f3/db2777?text=Run+D"]'::jsonb),
    (s_sport1, c_sport, 'Borraccia sport 750ml',            'Borraccia in tritan, BPA free.',                                 12.00,  'available', 60, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Borraccia"]'::jsonb),
    (s_sport1, c_sport, 'Asciugamano sport microfibra',     'Asciugamano 50x100cm, ad asciugatura rapida.',                   15.00,  'available', 45, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Asciugamano"]'::jsonb),
    (s_sport1, c_sport, 'Elastici fitness set 5pz',         'Bande elastiche di resistenze diverse.',                         18.00,  'available', 40, '["https://placehold.co/400x400/fef3c7/d97706?text=Elastici"]'::jsonb),
    (s_sport1, c_sport, 'Corda salto regolabile',           'Corda con cuscinetti, regolabile in lunghezza.',                 12.50,  'available', 50, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Corda"]'::jsonb),
    (s_sport1, c_sport, 'Foam roller massaggio',            'Rullo per automassaggio, 45cm.',                                 22.00,  'available', 30, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Roller"]'::jsonb),
    (s_sport1, c_sport, 'Magliette sport pack 3',           'T-shirt tecniche traspiranti.',                                  28.00,  'available', 35, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Magliette"]'::jsonb),
    (s_sport1, c_sport, 'Leggings sport donna',             'Leggings ad alto sostegno, vita alta.',                          38.00,  'available', 32, '["https://placehold.co/400x400/1f2937/f9fafb?text=Leggings"]'::jsonb),
    (s_sport1, c_sport, 'Borsone palestra 50L',             'Borsone con scomparto scarpe separato.',                         35.00,  'available', 25, '["https://placehold.co/400x400/1f2937/f9fafb?text=Borsone"]'::jsonb);

  -- SPORT 2: Outdoor Avventura
  INSERT INTO products (seller_id, category_id, name, description, price, status, stock, images) VALUES
    (s_sport2, c_sport, 'Tenda 2 posti compatta',           'Tenda igloo leggera, montaggio rapido.',                         98.00,  'available', 15, '["https://placehold.co/400x400/dcfce7/16a34a?text=Tenda"]'::jsonb),
    (s_sport2, c_sport, 'Sacco a pelo -5 gradi',            'Sacco invernale, imbottitura sintetica.',                        68.00,  'available', 20, '["https://placehold.co/400x400/1e3a8a/dbeafe?text=Sacco"]'::jsonb),
    (s_sport2, c_sport, 'Zaino trekking 45L',               'Zaino ergonomico con telaio interno.',                           78.00,  'available', 18, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Zaino"]'::jsonb),
    (s_sport2, c_sport, 'Bastoncini trekking coppia',       'Bastoncini in alluminio, telescopici.',                          38.00,  'available', 25, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Bastoncini"]'::jsonb),
    (s_sport2, c_sport, 'Lampada frontale LED',             'Lampada 350 lumen, ricaricabile USB.',                           22.00,  'available', 40, '["https://placehold.co/400x400/fef3c7/d97706?text=Frontale"]'::jsonb),
    (s_sport2, c_sport, 'Scarponcini trekking',             'Scarpe alte impermeabili, suola Vibram.',                        145.00, 'available', 18, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Scarponcini"]'::jsonb),
    (s_sport2, c_sport, 'Borraccia termica 1L',             'Borraccia in acciaio, mantiene caldo 12h.',                      25.00,  'available', 35, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Termica"]'::jsonb),
    (s_sport2, c_sport, 'Pentola campeggio 1.5L',           'Pentola in alluminio leggero con coperchio.',                    18.00,  'available', 28, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Pentola"]'::jsonb),
    (s_sport2, c_sport, 'Fornello gas portatile',           'Fornello compatto, alimentazione bombolette.',                   38.00,  'available', 20, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Fornello"]'::jsonb),
    (s_sport2, c_sport, 'Materassino gonfiabile',           'Materassino autogonfiante, 5cm spessore.',                       32.00,  'available', 22, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Materassino"]'::jsonb),
    (s_sport2, c_sport, 'Coltello multiuso',                'Coltello tipo svizzero, 12 funzioni.',                           28.00,  'available', 40, '["https://placehold.co/400x400/dc2626/fee2e2?text=Coltello"]'::jsonb),
    (s_sport2, c_sport, 'Telo emergenza isotermico',        'Telo riflettente, mantiene calore corporeo.',                    8.00,   'available', 60, '["https://placehold.co/400x400/f3f4f6/4b5563?text=Telo"]'::jsonb),
    (s_sport2, c_sport, 'Kit pronto soccorso outdoor',      'Kit con 65 pezzi, custodia impermeabile.',                       22.00,  'available', 30, '["https://placehold.co/400x400/dc2626/fee2e2?text=Kit"]'::jsonb),
    (s_sport2, c_sport, 'Ramponi ghiaccio',                 'Ramponi 10 punte, attacco universale.',                          38.00,  'available', 18, '["https://placehold.co/400x400/4b5563/f3f4f6?text=Ramponi"]'::jsonb),
    (s_sport2, c_sport, 'Borraccia idratante 2L',           'Sacca idratante con tubo per zaino.',                            19.00,  'available', 32, '["https://placehold.co/400x400/dbeafe/1e3a8a?text=Idratante"]'::jsonb);

END $$;

NOTIFY pgrst, 'reload schema';
