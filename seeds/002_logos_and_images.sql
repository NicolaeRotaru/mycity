-- Seed 002: imposta logo dei negozi demo e immagini prodotti
--
-- Tocca SOLO i seller demo (email @piacenza-demo.local). Idempotente:
-- ri-eseguibile senza effetti collaterali, le UPDATE sovrascrivono lo stato.
--
-- Logos: DiceBear "initials" (SVG, deterministico, colore di sfondo derivato
-- dal seed = nome negozio). Reso come <img> dal componente StoreAvatar.
--
-- Immagini prodotti: loremflickr.com con keyword inglese mappata dal nome
-- del prodotto. Il ?lock=N rende l'immagine stabile per quel prodotto.

DO $$
BEGIN
  ----------------------------------------------------------------
  -- 1) Logo per ogni negozio demo
  ----------------------------------------------------------------
  UPDATE profiles
  SET store_logo =
    'https://api.dicebear.com/9.x/initials/svg?seed='
    || replace(store_name, ' ', '+')
    || '&fontWeight=700&fontSize=42'
  WHERE id IN (
    SELECT id FROM auth.users WHERE email LIKE '%@piacenza-demo.local'
  )
    AND store_name IS NOT NULL;

  ----------------------------------------------------------------
  -- 2) Immagini prodotti: keyword inglese in base al nome
  ----------------------------------------------------------------
  UPDATE products
  SET images = jsonb_build_array(
    'https://loremflickr.com/400/400/' || (
      CASE
        -- Frutta e verdura
        WHEN name ILIKE '%pomodor%'                                    THEN 'tomato'
        WHEN name ILIKE '%insalata%'                                   THEN 'lettuce'
        WHEN name ILIKE '%carot%'                                      THEN 'carrot'
        WHEN name ILIKE '%patat%'                                      THEN 'potato'
        WHEN name ILIKE '%mele%'                                       THEN 'apple'
        WHEN name ILIKE '%banan%'                                      THEN 'banana'
        WHEN name ILIKE '%arance%'                                     THEN 'orange-fruit'
        WHEN name ILIKE '%limon%'                                      THEN 'lemon'
        WHEN name ILIKE '%zucchin%'                                    THEN 'zucchini'
        WHEN name ILIKE '%melanzan%'                                   THEN 'eggplant'
        WHEN name ILIKE '%pepero%'                                     THEN 'bell-pepper'
        WHEN name ILIKE '%fragol%'                                     THEN 'strawberry'
        WHEN name ILIKE '%uva%'                                        THEN 'grape'
        WHEN name ILIKE '%pere%' OR name ILIKE '%pera%'                THEN 'pear'
        WHEN name ILIKE '%cipoll%'                                     THEN 'onion'
        -- Salumi e formaggi
        WHEN name ILIKE '%coppa%' OR name ILIKE '%pancetta%'
          OR name ILIKE '%salame%' OR name ILIKE '%mortadella%'
          OR name ILIKE '%prosciutto%' OR name ILIKE '%bresaola%'
          OR name ILIKE '%speck%'                                      THEN 'salami'
        WHEN name ILIKE '%grana%' OR name ILIKE '%pecorino%'
          OR name ILIKE '%gorgonzola%' OR name ILIKE '%stracchino%'
          OR name ILIKE '%provolone%' OR name ILIKE '%mozzarella%'     THEN 'cheese'
        WHEN name ILIKE '%tortelli%' OR name ILIKE '%anolini%'
          OR name ILIKE '%pasta%'                                      THEN 'pasta'
        -- Abbigliamento
        WHEN name ILIKE '%vestito%'                                    THEN 'dress'
        WHEN name ILIKE '%camicia%' OR name ILIKE '%camicetta%'        THEN 'shirt'
        WHEN name ILIKE '%pantalon%' OR name ILIKE '%chino%'
          OR name ILIKE '%bermuda%'                                    THEN 'trousers'
        WHEN name ILIKE '%blazer%' OR name ILIKE '%giacca%'            THEN 'blazer'
        WHEN name ILIKE '%giubbino%' OR name ILIKE '%cappotto%'        THEN 'coat'
        WHEN name ILIKE '%borsa%' OR name ILIKE '%pochette%'           THEN 'handbag'
        WHEN name ILIKE '%scarpe%' OR name ILIKE '%sneakers%'
          OR name ILIKE '%stivali%' OR name ILIKE '%decollete%'
          OR name ILIKE '%scarpon%'                                    THEN 'shoes'
        WHEN name ILIKE '%sciarpa%'                                    THEN 'scarf'
        WHEN name ILIKE '%maglione%' OR name ILIKE '%cardigan%'        THEN 'sweater'
        WHEN name ILIKE '%gonna%'                                      THEN 'skirt'
        WHEN name ILIKE '%cintura%'                                    THEN 'belt'
        WHEN name ILIKE '%cappello%' OR name ILIKE '%berretto%'        THEN 'hat'
        WHEN name ILIKE '%t-shirt%' OR name ILIKE '%polo%'
          OR name ILIKE '%magliette%'                                  THEN 'tshirt'
        WHEN name ILIKE '%jeans%'                                      THEN 'jeans'
        WHEN name ILIKE '%felpa%'                                      THEN 'hoodie'
        WHEN name ILIKE '%boxer%' OR name ILIKE '%calzini%'            THEN 'socks'
        -- Casa & cucina
        WHEN name ILIKE '%lenzuola%' OR name ILIKE '%asciugamani%'     THEN 'bedding'
        WHEN name ILIKE '%cuscino%' OR name ILIKE '%coperta%'
          OR name ILIKE '%plaid%'                                      THEN 'pillow'
        WHEN name ILIKE '%tovaglia%' OR name ILIKE '%tovaglioli%'      THEN 'tablecloth'
        WHEN name ILIKE '%tappeto%'                                    THEN 'carpet'
        WHEN name ILIKE '%tende%'                                      THEN 'curtain'
        WHEN name ILIKE '%vaso%'                                       THEN 'vase'
        WHEN name ILIKE '%cornice%'                                    THEN 'photo-frame'
        WHEN name ILIKE '%lampada%'                                    THEN 'lamp'
        WHEN name ILIKE '%specchio%'                                   THEN 'mirror'
        WHEN name ILIKE '%diffusore%'                                  THEN 'aroma-diffuser'
        WHEN name ILIKE '%centrotavola%'                               THEN 'home-decor'
        WHEN name ILIKE '%pentol%' OR name ILIKE '%padel%'
          OR name ILIKE '%tegam%'                                      THEN 'cookware'
        WHEN name ILIKE '%posat%' OR name ILIKE '%coltell%'            THEN 'cutlery'
        WHEN name ILIKE '%caffe%' OR name ILIKE '%espresso%'
          OR name ILIKE '%macinacaffe%'                                THEN 'coffee'
        WHEN name ILIKE '%frullatore%' OR name ILIKE '%tritatutto%'
          OR name ILIKE '%spremiagrumi%' OR name ILIKE '%tostapane%'   THEN 'kitchen-appliance'
        WHEN name ILIKE '%bicchier%'                                   THEN 'wine-glass'
        WHEN name ILIKE '%caraffa%'                                    THEN 'pitcher'
        WHEN name ILIKE '%bilancia%'                                   THEN 'kitchen-scale'
        WHEN name ILIKE '%tagliere%'                                   THEN 'cutting-board'
        -- Elettronica
        WHEN name ILIKE '%cuffie%' OR name ILIKE '%auricolari%'
          OR name ILIKE '%airpods%'                                    THEN 'headphones'
        WHEN name ILIKE '%caricabatterie%' OR name ILIKE '%caricatore%'
          OR name ILIKE '%powerbank%' OR name ILIKE '%cavo%'           THEN 'charger'
        WHEN name ILIKE '%mouse%'                                      THEN 'computer-mouse'
        WHEN name ILIKE '%tastiera%'                                   THEN 'keyboard'
        WHEN name ILIKE '%webcam%' OR name ILIKE '%microfono%'         THEN 'microphone'
        WHEN name ILIKE '%speaker%'                                    THEN 'speaker'
        WHEN name ILIKE '%hub%' OR name ILIKE '%adattatore%'           THEN 'usb-hub'
        WHEN name ILIKE '%ssd%' OR name ILIKE '%memory%'               THEN 'ssd'
        WHEN name ILIKE '%cover%' OR name ILIKE '%pellicola%'
          OR name ILIKE '%custodia%'                                   THEN 'phone-case'
        WHEN name ILIKE '%smartwatch%' OR name ILIKE '%bracciale%'     THEN 'smartwatch'
        WHEN name ILIKE '%selfie%' OR name ILIKE '%anello%'            THEN 'ring-light'
        WHEN name ILIKE '%stand%'                                      THEN 'laptop'
        WHEN name ILIKE '%pad mouse%' OR name ILIKE '%mousepad%'       THEN 'desk'
        -- Libri / cartoleria
        WHEN name ILIKE '%romanzo%' OR name ILIKE '%libro%'
          OR name ILIKE '%classico%' OR name ILIKE '%manuale%'
          OR name ILIKE '%dizionario%' OR name ILIKE '%atlante%'
          OR name ILIKE '%guida%' OR name ILIKE '%biografia%'
          OR name ILIKE '%poesie%' OR name ILIKE '%giallo%'
          OR name ILIKE '%storia%' OR name ILIKE '%arte%'
          OR name ILIKE '%cucina italiana%' OR name ILIKE '%giardinaggio%'
          OR name ILIKE '%fotografia%' OR name ILIKE '%informatica%'
          OR name ILIKE '%i promessi%'                                 THEN 'book'
        WHEN name ILIKE '%quaderni%' OR name ILIKE '%agenda%'
          OR name ILIKE '%album%'                                      THEN 'notebook'
        WHEN name ILIKE '%penne%'                                      THEN 'pen'
        WHEN name ILIKE '%matite%' OR name ILIKE '%pennarelli%'
          OR name ILIKE '%pastelli%' OR name ILIKE '%matita%'          THEN 'pencils'
        WHEN name ILIKE '%astuccio%' OR name ILIKE '%zaino%'           THEN 'school-bag'
        WHEN name ILIKE '%risma%' OR name ILIKE '%cartelletta%'        THEN 'paper'
        WHEN name ILIKE '%forbici%'                                    THEN 'scissors'
        WHEN name ILIKE '%colla%'                                      THEN 'glue'
        WHEN name ILIKE '%calcolatrice%'                               THEN 'calculator'
        WHEN name ILIKE '%righelli%'                                   THEN 'ruler'
        -- Giardino
        WHEN name ILIKE '%basilico%' OR name ILIKE '%rosmarino%'
          OR name ILIKE '%menta%'                                      THEN 'herbs'
        WHEN name ILIKE '%lavanda%'                                    THEN 'lavender'
        WHEN name ILIKE '%orchidea%'                                   THEN 'orchid'
        WHEN name ILIKE '%cactus%' OR name ILIKE '%succulenta%'
          OR name ILIKE '%aloe%'                                       THEN 'succulent'
        WHEN name ILIKE '%bonsai%'                                     THEN 'bonsai'
        WHEN name ILIKE '%semi%'                                       THEN 'seeds'
        WHEN name ILIKE '%ficus%' OR name ILIKE '%pianta%'             THEN 'houseplant'
        WHEN name ILIKE '%terriccio%' OR name ILIKE '%fertilizzante%'
          OR name ILIKE '%concime%'                                    THEN 'soil'
        WHEN name ILIKE '%annaffiatoio%' OR name ILIKE '%tubo gomma%'  THEN 'watering-can'
        WHEN name ILIKE '%guanti giardinaggio%'                        THEN 'gardening-gloves'
        WHEN name ILIKE '%vanga%' OR name ILIKE '%attrezzi%'
          OR name ILIKE '%decespugliatore%' OR name ILIKE '%tagliasiepi%'
          OR name ILIKE '%soffiatore%' OR name ILIKE '%carriola%'      THEN 'garden-tools'
        WHEN name ILIKE '%cassetta%' OR name ILIKE '%fioriera%'        THEN 'planter'
        WHEN name ILIKE '%rete%' OR name ILIKE '%trappola%'
          OR name ILIKE '%sacchi%'                                     THEN 'gardening'
        -- Bellezza
        WHEN name ILIKE '%crema%' OR name ILIKE '%balsamo%'
          OR name ILIKE '%burro%'                                      THEN 'face-cream'
        WHEN name ILIKE '%olio%' OR name ILIKE '%siero%'               THEN 'beauty-serum'
        WHEN name ILIKE '%shampoo%' OR name ILIKE '%detergente%'       THEN 'shampoo'
        WHEN name ILIKE '%bagno schiuma%'                              THEN 'bath'
        WHEN name ILIKE '%maschera%' OR name ILIKE '%scrub%'           THEN 'face-mask'
        WHEN name ILIKE '%profumo%' OR name ILIKE '%eau de%'           THEN 'perfume'
        WHEN name ILIKE '%rossetto%' OR name ILIKE '%smalto%'
          OR name ILIKE '%mascara%' OR name ILIKE '%ombretti%'
          OR name ILIKE '%palette%' OR name ILIKE '%fondotinta%'
          OR name ILIKE '%cipria%' OR name ILIKE '%eyeliner%'
          OR name ILIKE '%set make-up%'                                THEN 'makeup'
        WHEN name ILIKE '%spazzola%'                                   THEN 'hair-brush'
        WHEN name ILIKE '%solare%'                                     THEN 'sunscreen'
        WHEN name ILIKE '%tonico%'                                     THEN 'skincare'
        -- Sport / outdoor
        WHEN name ILIKE '%yoga%'                                       THEN 'yoga'
        WHEN name ILIKE '%manubri%' OR name ILIKE '%bilanciere%'       THEN 'dumbbell'
        WHEN name ILIKE '%tuta%' OR name ILIKE '%leggings%'            THEN 'activewear'
        WHEN name ILIKE '%running%'                                    THEN 'running-shoes'
        WHEN name ILIKE '%borraccia%'                                  THEN 'water-bottle'
        WHEN name ILIKE '%asciugamano sport%'                          THEN 'gym-towel'
        WHEN name ILIKE '%elastici%' OR name ILIKE '%foam%'
          OR name ILIKE '%corda salto%'                                THEN 'fitness'
        WHEN name ILIKE '%borsone%'                                    THEN 'gym-bag'
        WHEN name ILIKE '%tenda%'                                      THEN 'tent'
        WHEN name ILIKE '%sacco a pelo%'                               THEN 'sleeping-bag'
        WHEN name ILIKE '%zaino trekking%'                             THEN 'backpack'
        WHEN name ILIKE '%bastoncini trekking%'                        THEN 'hiking-poles'
        WHEN name ILIKE '%frontale%'                                   THEN 'headlamp'
        WHEN name ILIKE '%fornello%' OR name ILIKE '%pentola campeggio%' THEN 'camping-stove'
        WHEN name ILIKE '%materassino%'                                THEN 'sleeping-pad'
        WHEN name ILIKE '%kit pronto soccorso%'                        THEN 'first-aid'
        WHEN name ILIKE '%ramponi%'                                    THEN 'crampons'
        WHEN name ILIKE '%coltello multiuso%'                          THEN 'pocket-knife'
        WHEN name ILIKE '%telo%'                                       THEN 'outdoor'
        -- Fallback per categoria
        ELSE (SELECT slug FROM categories WHERE id = products.category_id)
      END
    ) || '?lock=' || ((abs(hashtext(id::text)) % 50) + 1)
  )
  WHERE seller_id IN (
    SELECT id FROM auth.users WHERE email LIKE '%@piacenza-demo.local'
  );

END $$;

NOTIFY pgrst, 'reload schema';
