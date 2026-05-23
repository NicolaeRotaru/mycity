-- Seed 002: imposta logo dei negozi demo e immagini prodotti
--
-- Tocca SOLO i seller demo (email @piacenza-demo.local). Idempotente:
-- ri-eseguibile senza effetti collaterali, le UPDATE sovrascrivono lo stato.
--
-- Logos: foto Pexels tematiche per ogni negozio (square crop 400x400).
-- Sono foto reali di prodotti che rappresentano il negozio.
--
-- Immagini prodotti: Iconify Material Design Icons — placeholder
-- che vengono poi sovrascritte dal seed 003 con vere foto Pexels.

DO $$
BEGIN
  ----------------------------------------------------------------
  -- 1) Logo per ogni negozio demo (foto Pexels tematiche)
  ----------------------------------------------------------------
  -- Salumeria del Borgo: coppa stagionata
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/6416558/pexels-photo-6416558.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-aaaaaaaa0001';
  -- Frutteto Verde: pomodorini freschi
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/14657386/pexels-photo-14657386.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-aaaaaaaa0002';
  -- Boutique Eleganza: vestito elegante
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/2169300/pexels-photo-2169300.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-bbbbbbbb0001';
  -- Stile Urbano: streetwear
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/19461512/pexels-photo-19461512.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-bbbbbbbb0002';
  -- Casa Linda: tessili casa
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/9330891/pexels-photo-9330891.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-cccccccc0001';
  -- Cucina Plus: utensili cucina
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/36552082/pexels-photo-36552082.png?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-cccccccc0002';
  -- TechZone Piacenza: cuffie tech
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/3394648/pexels-photo-3394648.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-dddddddd0001';
  -- Smart Store: accessori mobile
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/18311092/pexels-photo-18311092.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-dddddddd0002';
  -- Libreria Romana: libri
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/4170628/pexels-photo-4170628.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-eeeeeeee0001';
  -- Cartoleria Centrale: cancelleria
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/8230968/pexels-photo-8230968.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-eeeeeeee0002';
  -- Verde Casa: piante
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/18254763/pexels-photo-18254763.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-ffffffff0001';
  -- Giardino Bello: giardinaggio
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/14822844/pexels-photo-14822844.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-ffffffff0002';
  -- Bellezza Naturale: cosmetici bio
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/4841466/pexels-photo-4841466.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-99999999a001';
  -- Profumeria Charme: profumi
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/11288844/pexels-photo-11288844.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-99999999a002';
  -- SportFit Piacenza: fitness
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/16148425/pexels-photo-16148425.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-88888888a001';
  -- Outdoor Avventura: trekking outdoor
  UPDATE profiles SET store_logo = 'https://images.pexels.com/photos/31861359/pexels-photo-31861359.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop'
    WHERE id = '11111111-1111-1111-1111-88888888a002';

  ----------------------------------------------------------------
  -- 2) Icone prodotti (Iconify MDI), colorate per categoria
  ----------------------------------------------------------------
  UPDATE products
  SET images = jsonb_build_array(
    'https://api.iconify.design/mdi:' || (
      CASE
        -- ALIMENTARI: frutta e verdura
        WHEN name ILIKE '%pomodor%'                                    THEN 'food-apple'
        WHEN name ILIKE '%insalata%'                                   THEN 'leaf'
        WHEN name ILIKE '%carot%'                                      THEN 'carrot'
        WHEN name ILIKE '%patat%'                                      THEN 'food'
        WHEN name ILIKE '%mele%'                                       THEN 'food-apple'
        WHEN name ILIKE '%banan%'                                      THEN 'food'
        WHEN name ILIKE '%arance%' OR name ILIKE '%limon%'             THEN 'food-apple-outline'
        WHEN name ILIKE '%zucchin%' OR name ILIKE '%melanzan%' OR name ILIKE '%pepero%' THEN 'leaf'
        WHEN name ILIKE '%fragol%' OR name ILIKE '%uva%' OR name ILIKE '%pere%' OR name ILIKE '%pera%' THEN 'food-apple'
        WHEN name ILIKE '%cipoll%'                                     THEN 'food'
        -- ALIMENTARI: salumi e formaggi
        WHEN name ILIKE '%coppa%' OR name ILIKE '%pancetta%'
          OR name ILIKE '%salame%' OR name ILIKE '%mortadella%'
          OR name ILIKE '%prosciutto%' OR name ILIKE '%bresaola%'
          OR name ILIKE '%speck%'                                      THEN 'food-steak'
        WHEN name ILIKE '%grana%' OR name ILIKE '%pecorino%'
          OR name ILIKE '%gorgonzola%' OR name ILIKE '%stracchino%'
          OR name ILIKE '%provolone%' OR name ILIKE '%mozzarella%'     THEN 'cheese'
        WHEN name ILIKE '%tortelli%' OR name ILIKE '%anolini%'
          OR name ILIKE '%pasta%'                                      THEN 'pasta'
        -- ABBIGLIAMENTO
        WHEN name ILIKE '%vestito%'                                    THEN 'hanger'
        WHEN name ILIKE '%camicia di seta%' OR name ILIKE '%camicetta%' THEN 'tshirt-crew'
        WHEN name ILIKE '%camicia%'                                    THEN 'tshirt-v'
        WHEN name ILIKE '%blazer%' OR name ILIKE '%giacca%'            THEN 'coat-rack'
        WHEN name ILIKE '%giubbino%' OR name ILIKE '%cappotto%'        THEN 'coat-rack'
        WHEN name ILIKE '%pantalon%' OR name ILIKE '%chino%'
          OR name ILIKE '%bermuda%' OR name ILIKE '%jeans%'            THEN 'human-handsdown'
        WHEN name ILIKE '%gonna%'                                      THEN 'human-female'
        WHEN name ILIKE '%borsa%' OR name ILIKE '%pochette%'           THEN 'bag-personal'
        WHEN name ILIKE '%decollete%' OR name ILIKE '%stivali%'        THEN 'shoe-heel'
        WHEN name ILIKE '%sneakers%' OR name ILIKE '%scarpe running%'
          OR name ILIKE '%running%'                                    THEN 'shoe-sneaker'
        WHEN name ILIKE '%scarpe%' OR name ILIKE '%scarpon%'           THEN 'shoe-formal'
        WHEN name ILIKE '%sciarpa%'                                    THEN 'scarf'
        WHEN name ILIKE '%maglione%' OR name ILIKE '%cardigan%'        THEN 'tshirt-crew-outline'
        WHEN name ILIKE '%cappello%' OR name ILIKE '%berretto%'        THEN 'hat-fedora'
        WHEN name ILIKE '%t-shirt%' OR name ILIKE '%polo%'
          OR name ILIKE '%magliette%'                                  THEN 'tshirt-crew'
        WHEN name ILIKE '%felpa%'                                      THEN 'tshirt-v'
        WHEN name ILIKE '%boxer%'                                      THEN 'human'
        WHEN name ILIKE '%calzini%'                                    THEN 'sock'
        WHEN name ILIKE '%cintura%'                                    THEN 'tape-measure'
        -- CASA: tessili
        WHEN name ILIKE '%lenzuola%'                                   THEN 'bed-king'
        WHEN name ILIKE '%asciugamani%'                                THEN 'shower'
        WHEN name ILIKE '%cuscino%' OR name ILIKE '%coperta%'
          OR name ILIKE '%plaid%'                                      THEN 'bed-empty'
        WHEN name ILIKE '%tovaglia%' OR name ILIKE '%tovaglioli%'      THEN 'silverware-fork-knife'
        WHEN name ILIKE '%tappeto%'                                    THEN 'rug'
        WHEN name ILIKE '%tende%'                                      THEN 'curtains'
        -- CASA: decor
        WHEN name ILIKE '%vaso%'                                       THEN 'flower-tulip'
        WHEN name ILIKE '%cornice%'                                    THEN 'image-frame'
        WHEN name ILIKE '%lampada%'                                    THEN 'lamp'
        WHEN name ILIKE '%specchio%'                                   THEN 'mirror'
        WHEN name ILIKE '%diffusore%'                                  THEN 'spray'
        WHEN name ILIKE '%centrotavola%'                               THEN 'home-variant'
        -- CASA: cucina
        WHEN name ILIKE '%pentol%' OR name ILIKE '%padel%' OR name ILIKE '%tegam%' THEN 'pot-steam'
        WHEN name ILIKE '%posat%'                                      THEN 'silverware'
        WHEN name ILIKE '%coltell%'                                    THEN 'knife'
        WHEN name ILIKE '%macchina caffe%' OR name ILIKE '%espresso%'
          OR name ILIKE '%macinacaffe%'                                THEN 'coffee-maker'
        WHEN name ILIKE '%frullatore%' OR name ILIKE '%tritatutto%'    THEN 'blender'
        WHEN name ILIKE '%spremiagrumi%'                               THEN 'fruit-citrus'
        WHEN name ILIKE '%tostapane%'                                  THEN 'toaster'
        WHEN name ILIKE '%bicchier%'                                   THEN 'glass-wine'
        WHEN name ILIKE '%caraffa%'                                    THEN 'cup-water'
        WHEN name ILIKE '%bilancia%'                                   THEN 'scale-bathroom'
        WHEN name ILIKE '%tagliere%'                                   THEN 'knife'
        -- ELETTRONICA
        WHEN name ILIKE '%cuffie%'                                     THEN 'headphones'
        WHEN name ILIKE '%auricolari%' OR name ILIKE '%airpods%'       THEN 'earbuds'
        WHEN name ILIKE '%caricabatterie%' OR name ILIKE '%caricatore%' THEN 'power-plug'
        WHEN name ILIKE '%powerbank%'                                  THEN 'battery-charging-high'
        WHEN name ILIKE '%cavo%'                                       THEN 'cable-data'
        WHEN name ILIKE '%mouse%'                                      THEN 'mouse'
        WHEN name ILIKE '%tastiera%'                                   THEN 'keyboard'
        WHEN name ILIKE '%webcam%'                                     THEN 'webcam'
        WHEN name ILIKE '%microfono%'                                  THEN 'microphone'
        WHEN name ILIKE '%speaker%'                                    THEN 'speaker'
        WHEN name ILIKE '%hub%' OR name ILIKE '%adattatore%'           THEN 'usb-port'
        WHEN name ILIKE '%ssd%'                                        THEN 'harddisk'
        WHEN name ILIKE '%memory%'                                     THEN 'sd'
        WHEN name ILIKE '%cover%' OR name ILIKE '%custodia%'
          OR name ILIKE '%pellicola%'                                  THEN 'cellphone'
        WHEN name ILIKE '%smartwatch%' OR name ILIKE '%bracciale fitness%' THEN 'watch'
        WHEN name ILIKE '%selfie%'                                     THEN 'cellphone-screenshot'
        WHEN name ILIKE '%anello luminoso%' OR name ILIKE '%lampada led%' THEN 'lightbulb-on'
        WHEN name ILIKE '%stand%'                                      THEN 'laptop'
        WHEN name ILIKE '%pad mouse%' OR name ILIKE '%mousepad%'       THEN 'mouse-variant'
        WHEN name ILIKE '%supporto%'                                   THEN 'car-cog'
        -- LIBRI / CARTOLERIA
        WHEN name ILIKE '%dizionario%' OR name ILIKE '%atlante%'       THEN 'book-multiple'
        WHEN name ILIKE '%agenda%'                                     THEN 'calendar-month'
        WHEN name ILIKE '%album%'                                      THEN 'palette'
        WHEN name ILIKE '%libro%' OR name ILIKE '%romanzo%' OR name ILIKE '%classico%'
          OR name ILIKE '%manuale%' OR name ILIKE '%biografia%' OR name ILIKE '%poesie%'
          OR name ILIKE '%giallo%' OR name ILIKE '%storia%' OR name ILIKE '%arte%'
          OR name ILIKE '%i promessi%' OR name ILIKE '%guida%'         THEN 'book-open-page-variant'
        WHEN name ILIKE '%quaderni%'                                   THEN 'notebook'
        WHEN name ILIKE '%penne%' OR name ILIKE '%matita%'             THEN 'pen'
        WHEN name ILIKE '%matite%'                                     THEN 'pencil'
        WHEN name ILIKE '%pennarelli%' OR name ILIKE '%pastelli%'      THEN 'palette'
        WHEN name ILIKE '%astuccio%'                                   THEN 'pencil-box'
        WHEN name ILIKE '%zaino%'                                      THEN 'bag-personal'
        WHEN name ILIKE '%risma%' OR name ILIKE '%cartelletta%'        THEN 'file-document'
        WHEN name ILIKE '%forbici%'                                    THEN 'content-cut'
        WHEN name ILIKE '%colla%'                                      THEN 'water'
        WHEN name ILIKE '%calcolatrice%'                               THEN 'calculator'
        WHEN name ILIKE '%righelli%'                                   THEN 'ruler'
        -- GIARDINO
        WHEN name ILIKE '%basilico%' OR name ILIKE '%rosmarino%'
          OR name ILIKE '%menta%'                                      THEN 'sprout'
        WHEN name ILIKE '%lavanda%'                                    THEN 'flower'
        WHEN name ILIKE '%orchidea%'                                   THEN 'flower-tulip'
        WHEN name ILIKE '%cactus%' OR name ILIKE '%succulenta%'
          OR name ILIKE '%aloe%'                                       THEN 'cactus'
        WHEN name ILIKE '%bonsai%'                                     THEN 'tree'
        WHEN name ILIKE '%semi%'                                       THEN 'seed'
        WHEN name ILIKE '%ficus%' OR name ILIKE '%pianta%'             THEN 'tree-outline'
        WHEN name ILIKE '%terriccio%' OR name ILIKE '%fertilizzante%'
          OR name ILIKE '%concime%'                                    THEN 'shovel'
        WHEN name ILIKE '%annaffiatoio%' OR name ILIKE '%tubo gomma%'  THEN 'watering-can'
        WHEN name ILIKE '%guanti giardinaggio%'                        THEN 'hand-back-right'
        WHEN name ILIKE '%forbici da potatura%'                        THEN 'content-cut'
        WHEN name ILIKE '%vanga%'                                      THEN 'shovel'
        WHEN name ILIKE '%attrezzi%'                                   THEN 'tools'
        WHEN name ILIKE '%decespugliatore%' OR name ILIKE '%tagliasiepi%' THEN 'saw-blade'
        WHEN name ILIKE '%soffiatore%'                                 THEN 'fan'
        WHEN name ILIKE '%carriola%'                                   THEN 'wheelchair'
        WHEN name ILIKE '%cassetta%' OR name ILIKE '%fioriera%'        THEN 'flower-poppy'
        WHEN name ILIKE '%rete%'                                       THEN 'grid'
        WHEN name ILIKE '%trappola%'                                   THEN 'bug'
        WHEN name ILIKE '%sacchi%'                                     THEN 'sack'
        -- BELLEZZA
        WHEN name ILIKE '%crema viso%' OR name ILIKE '%crema antieta%'
          OR name ILIKE '%crema mani%' OR name ILIKE '%crema corpo%'
          OR name ILIKE '%crema solare%' OR name ILIKE '%crema%'       THEN 'face-woman'
        WHEN name ILIKE '%balsamo%'                                    THEN 'bottle-tonic'
        WHEN name ILIKE '%burro%'                                      THEN 'bottle-tonic-plus'
        WHEN name ILIKE '%olio%' OR name ILIKE '%siero%'               THEN 'bottle-tonic-skull'
        WHEN name ILIKE '%shampoo%' OR name ILIKE '%detergente%'       THEN 'shower-head'
        WHEN name ILIKE '%bagno schiuma%'                              THEN 'shower'
        WHEN name ILIKE '%maschera%'                                   THEN 'face-mask'
        WHEN name ILIKE '%scrub%'                                      THEN 'spa'
        WHEN name ILIKE '%profumo%' OR name ILIKE '%eau de%'           THEN 'spray'
        WHEN name ILIKE '%rossetto%' OR name ILIKE '%matita labbra%'   THEN 'lipstick'
        WHEN name ILIKE '%smalto%'                                     THEN 'brush'
        WHEN name ILIKE '%mascara%' OR name ILIKE '%eyeliner%'         THEN 'eye'
        WHEN name ILIKE '%ombretti%' OR name ILIKE '%palette%'
          OR name ILIKE '%fondotinta%' OR name ILIKE '%cipria%'
          OR name ILIKE '%set make-up%'                                THEN 'palette-swatch'
        WHEN name ILIKE '%spazzola%'                                   THEN 'brush-variant'
        WHEN name ILIKE '%tonico%'                                     THEN 'bottle-soda'
        -- SPORT / OUTDOOR
        WHEN name ILIKE '%tappetino yoga%' OR name ILIKE '%yoga%'      THEN 'yoga'
        WHEN name ILIKE '%manubri%' OR name ILIKE '%bilanciere%'       THEN 'dumbbell'
        WHEN name ILIKE '%tuta%' OR name ILIKE '%leggings%'            THEN 'human-handsup'
        WHEN name ILIKE '%borraccia%'                                  THEN 'bottle-soda-classic'
        WHEN name ILIKE '%asciugamano sport%'                          THEN 'towel'
        WHEN name ILIKE '%elastici%' OR name ILIKE '%corda salto%'     THEN 'sync'
        WHEN name ILIKE '%foam roller%' OR name ILIKE '%foam%'         THEN 'arm-flex'
        WHEN name ILIKE '%borsone%'                                    THEN 'bag-checked'
        WHEN name ILIKE '%tenda%'                                      THEN 'tent'
        WHEN name ILIKE '%sacco a pelo%'                               THEN 'bed-empty'
        WHEN name ILIKE '%zaino trekking%'                             THEN 'bag-personal'
        WHEN name ILIKE '%bastoncini trekking%'                        THEN 'hiking'
        WHEN name ILIKE '%lampada frontale%' OR name ILIKE '%frontale%' THEN 'flashlight'
        WHEN name ILIKE '%fornello%' OR name ILIKE '%pentola campeggio%' THEN 'campfire'
        WHEN name ILIKE '%materassino%'                                THEN 'bed-empty'
        WHEN name ILIKE '%coltello multiuso%'                          THEN 'knife-military'
        WHEN name ILIKE '%telo%'                                       THEN 'tent'
        WHEN name ILIKE '%kit pronto soccorso%'                        THEN 'medical-bag'
        WHEN name ILIKE '%ramponi%'                                    THEN 'snowflake'
        -- Fallback per categoria
        ELSE 'package-variant'
      END
    ) || '.svg?color=%23' || (
      CASE (SELECT slug FROM categories WHERE id = products.category_id)
        WHEN 'alimentari'    THEN 'dc2626'  -- rosso
        WHEN 'abbigliamento' THEN '4f46e5'  -- indigo
        WHEN 'casa'          THEN 'd97706'  -- ambra
        WHEN 'elettronica'   THEN '475569'  -- slate
        WHEN 'libri'         THEN '059669'  -- emerald
        WHEN 'giardino'      THEN '16a34a'  -- verde
        WHEN 'bellezza'      THEN 'db2777'  -- rosa
        WHEN 'sport'         THEN 'ea580c'  -- arancio
        ELSE '475569'
      END
    ) || '&width=400&height=400'
  )
  WHERE seller_id IN (
    SELECT id FROM auth.users WHERE email LIKE '%@piacenza-demo.local'
  );

END $$;

NOTIFY pgrst, 'reload schema';
