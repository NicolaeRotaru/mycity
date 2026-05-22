-- Seed 002: imposta logo dei negozi demo e immagini prodotti
--
-- Tocca SOLO i seller demo (email @piacenza-demo.local). Idempotente:
-- ri-eseguibile senza effetti collaterali, le UPDATE sovrascrivono lo stato.
--
-- Logos: DiceBear "initials" (SVG, deterministico, colore di sfondo derivato
-- dal seed = nome negozio). Reso come <img> dal componente StoreAvatar.
--
-- Immagini prodotti: Unsplash Source (foto professionali) con keyword
-- inglese multi-parola mappata dal nome del prodotto.
-- Il &sig=<N> stabilizza la foto: con stesso sig Unsplash restituisce lo
-- stesso scatto, cosi' il prodotto non cambia immagine ad ogni ricarica.

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
  -- 2) Immagini prodotti: keyword Unsplash specifiche per ogni nome
  ----------------------------------------------------------------
  UPDATE products
  SET images = jsonb_build_array(
    'https://source.unsplash.com/400x400/?' || (
      CASE
        -- ALIMENTARI: frutta e verdura
        WHEN name ILIKE '%pomodor%'                                    THEN 'fresh-tomato,vegetable'
        WHEN name ILIKE '%insalata%'                                   THEN 'lettuce,green-salad'
        WHEN name ILIKE '%carot%'                                      THEN 'fresh-carrot,vegetable'
        WHEN name ILIKE '%patat%'                                      THEN 'potato,vegetable'
        WHEN name ILIKE '%mele%'                                       THEN 'fresh-apple,fruit'
        WHEN name ILIKE '%banan%'                                      THEN 'banana,fruit'
        WHEN name ILIKE '%arance%'                                     THEN 'orange,citrus'
        WHEN name ILIKE '%limon%'                                      THEN 'lemon,citrus'
        WHEN name ILIKE '%zucchin%'                                    THEN 'zucchini,green-vegetable'
        WHEN name ILIKE '%melanzan%'                                   THEN 'eggplant,aubergine'
        WHEN name ILIKE '%pepero%'                                     THEN 'bell-pepper,vegetable'
        WHEN name ILIKE '%fragol%'                                     THEN 'strawberry,red-fruit'
        WHEN name ILIKE '%uva%'                                        THEN 'grapes,fruit'
        WHEN name ILIKE '%pere%' OR name ILIKE '%pera%'                THEN 'pear,fresh-fruit'
        WHEN name ILIKE '%cipoll%'                                     THEN 'onion,vegetable'
        -- ALIMENTARI: salumi e formaggi
        WHEN name ILIKE '%coppa%' OR name ILIKE '%pancetta%'           THEN 'italian-salami,charcuterie'
        WHEN name ILIKE '%salame%'                                     THEN 'salami,cured-meat'
        WHEN name ILIKE '%mortadella%'                                 THEN 'mortadella,italian-deli'
        WHEN name ILIKE '%prosciutto%'                                 THEN 'prosciutto,parma-ham'
        WHEN name ILIKE '%bresaola%'                                   THEN 'bresaola,cured-meat'
        WHEN name ILIKE '%speck%'                                      THEN 'speck,smoked-ham'
        WHEN name ILIKE '%grana%'                                      THEN 'parmesan,aged-cheese'
        WHEN name ILIKE '%pecorino%'                                   THEN 'pecorino,sheep-cheese'
        WHEN name ILIKE '%gorgonzola%'                                 THEN 'gorgonzola,blue-cheese'
        WHEN name ILIKE '%stracchino%' OR name ILIKE '%mozzarella%'    THEN 'fresh-cheese,italian-cheese'
        WHEN name ILIKE '%provolone%'                                  THEN 'provolone,italian-cheese'
        WHEN name ILIKE '%tortelli%' OR name ILIKE '%anolini%'         THEN 'fresh-pasta,italian-food'
        -- ABBIGLIAMENTO donna
        WHEN name ILIKE '%vestito%'                                    THEN 'summer-dress,fashion'
        WHEN name ILIKE '%camicia di seta%'                            THEN 'silk-blouse,white-shirt'
        WHEN name ILIKE '%camicetta%'                                  THEN 'blouse,women-fashion'
        WHEN name ILIKE '%pantaloni elegant%'                          THEN 'elegant-trousers,women-pants'
        WHEN name ILIKE '%blazer%'                                     THEN 'blazer,jacket-fashion'
        WHEN name ILIKE '%borsa a tracolla%' OR name ILIKE '%pochette%' THEN 'leather-handbag,fashion-bag'
        WHEN name ILIKE '%borsa%'                                      THEN 'handbag,fashion'
        WHEN name ILIKE '%decollete%'                                  THEN 'high-heels,women-shoes'
        WHEN name ILIKE '%stivali%'                                    THEN 'leather-boots,fashion'
        WHEN name ILIKE '%sciarpa%'                                    THEN 'cashmere-scarf,winter-fashion'
        WHEN name ILIKE '%maglione%'                                   THEN 'sweater,knitwear'
        WHEN name ILIKE '%cardigan%'                                   THEN 'cardigan,knitwear'
        WHEN name ILIKE '%gonna%'                                      THEN 'midi-skirt,women-fashion'
        WHEN name ILIKE '%cappello panama%'                            THEN 'panama-hat,straw-hat'
        WHEN name ILIKE '%cappello%' OR name ILIKE '%berretto%'        THEN 'hat,winter-cap'
        -- ABBIGLIAMENTO uomo / unisex
        WHEN name ILIKE '%t-shirt%' OR name ILIKE '%polo%' OR name ILIKE '%magliette%' THEN 'tshirt,casual-fashion'
        WHEN name ILIKE '%jeans%'                                      THEN 'jeans,denim'
        WHEN name ILIKE '%felpa%'                                      THEN 'hoodie,sweatshirt'
        WHEN name ILIKE '%camicia%'                                    THEN 'shirt,men-fashion'
        WHEN name ILIKE '%giubbino%'                                   THEN 'leather-jacket,biker'
        WHEN name ILIKE '%cappotto%'                                   THEN 'wool-coat,winter-jacket'
        WHEN name ILIKE '%pantaloni chino%' OR name ILIKE '%chino%'    THEN 'chino-pants,casual'
        WHEN name ILIKE '%bermuda%'                                    THEN 'shorts,summer-fashion'
        WHEN name ILIKE '%pantaloni%'                                  THEN 'pants,trousers'
        WHEN name ILIKE '%sneakers%'                                   THEN 'sneakers,white-shoes'
        WHEN name ILIKE '%scarpe%' OR name ILIKE '%scarpon%'           THEN 'shoes,footwear'
        WHEN name ILIKE '%boxer%'                                      THEN 'underwear,boxer'
        WHEN name ILIKE '%calzini%'                                    THEN 'socks,sport-socks'
        WHEN name ILIKE '%cintura%'                                    THEN 'leather-belt,accessory'
        -- CASA: tessili
        WHEN name ILIKE '%lenzuola%'                                   THEN 'bed-sheets,bedding'
        WHEN name ILIKE '%asciugamani%'                                THEN 'towels,bathroom'
        WHEN name ILIKE '%cuscino%'                                    THEN 'decorative-pillow,cushion'
        WHEN name ILIKE '%coperta%' OR name ILIKE '%plaid%'            THEN 'blanket,throw'
        WHEN name ILIKE '%tovaglia%'                                   THEN 'tablecloth,table-setting'
        WHEN name ILIKE '%tovaglioli%'                                 THEN 'napkins,linen'
        WHEN name ILIKE '%tappeto%'                                    THEN 'rug,living-room'
        WHEN name ILIKE '%tende%'                                      THEN 'curtains,window'
        -- CASA: decor
        WHEN name ILIKE '%vaso%'                                       THEN 'ceramic-vase,home-decor'
        WHEN name ILIKE '%cornice%'                                    THEN 'photo-frame,picture-frame'
        WHEN name ILIKE '%lampada%'                                    THEN 'table-lamp,interior'
        WHEN name ILIKE '%specchio%'                                   THEN 'mirror,wall-decor'
        WHEN name ILIKE '%diffusore%'                                  THEN 'aroma-diffuser,wellness'
        WHEN name ILIKE '%centrotavola%'                               THEN 'centerpiece,table-decor'
        -- CASA: cucina
        WHEN name ILIKE '%pentole%' OR name ILIKE '%padel%'            THEN 'cookware,pots'
        WHEN name ILIKE '%tegam%'                                      THEN 'baking-dish,kitchen'
        WHEN name ILIKE '%posat%'                                      THEN 'cutlery,silverware'
        WHEN name ILIKE '%coltell%'                                    THEN 'kitchen-knives,chef'
        WHEN name ILIKE '%macchina caffe%' OR name ILIKE '%espresso%'  THEN 'espresso-machine,coffee'
        WHEN name ILIKE '%macinacaffe%'                                THEN 'coffee-grinder,coffee'
        WHEN name ILIKE '%frullatore%'                                 THEN 'blender,kitchen-appliance'
        WHEN name ILIKE '%tritatutto%'                                 THEN 'food-processor,kitchen'
        WHEN name ILIKE '%spremiagrumi%'                               THEN 'juicer,citrus-juicer'
        WHEN name ILIKE '%tostapane%'                                  THEN 'toaster,kitchen'
        WHEN name ILIKE '%bicchier%'                                   THEN 'wine-glasses,glassware'
        WHEN name ILIKE '%caraffa%'                                    THEN 'water-pitcher,glass-jug'
        WHEN name ILIKE '%bilancia%'                                   THEN 'kitchen-scale,baking'
        WHEN name ILIKE '%tagliere%'                                   THEN 'cutting-board,wooden'
        -- ELETTRONICA
        WHEN name ILIKE '%cuffie%'                                     THEN 'headphones,over-ear'
        WHEN name ILIKE '%auricolari%' OR name ILIKE '%airpods%'       THEN 'earbuds,wireless-audio'
        WHEN name ILIKE '%caricabatterie%' OR name ILIKE '%caricatore%' THEN 'usb-charger,phone-charger'
        WHEN name ILIKE '%powerbank%'                                  THEN 'powerbank,portable-charger'
        WHEN name ILIKE '%cavo%'                                       THEN 'usb-cable,charging-cable'
        WHEN name ILIKE '%mouse%'                                      THEN 'wireless-mouse,desk-setup'
        WHEN name ILIKE '%tastiera%'                                   THEN 'mechanical-keyboard,gaming'
        WHEN name ILIKE '%webcam%'                                     THEN 'webcam,video-call'
        WHEN name ILIKE '%microfono%'                                  THEN 'microphone,podcast'
        WHEN name ILIKE '%speaker%'                                    THEN 'bluetooth-speaker,audio'
        WHEN name ILIKE '%hub%' OR name ILIKE '%adattatore%'           THEN 'usb-hub,tech-accessories'
        WHEN name ILIKE '%ssd%'                                        THEN 'ssd-drive,storage'
        WHEN name ILIKE '%memory%'                                     THEN 'memory-card,sd-card'
        WHEN name ILIKE '%cover iphone%'                               THEN 'iphone-case,phone-case'
        WHEN name ILIKE '%cover samsung%'                              THEN 'samsung-case,phone-case'
        WHEN name ILIKE '%cover%' OR name ILIKE '%custodia%'           THEN 'phone-case,accessories'
        WHEN name ILIKE '%pellicola%'                                  THEN 'screen-protector,tempered-glass'
        WHEN name ILIKE '%smartwatch%'                                 THEN 'smartwatch,wearable'
        WHEN name ILIKE '%bracciale fitness%'                          THEN 'fitness-tracker,wearable'
        WHEN name ILIKE '%selfie%'                                     THEN 'selfie-stick,tripod'
        WHEN name ILIKE '%anello luminoso%'                            THEN 'ring-light,photography'
        WHEN name ILIKE '%lampada led%'                                THEN 'desk-lamp,led-light'
        WHEN name ILIKE '%stand%'                                      THEN 'laptop-stand,desk'
        WHEN name ILIKE '%pad mouse%'                                  THEN 'mousepad,gaming-desk'
        WHEN name ILIKE '%supporto%'                                   THEN 'phone-holder,car-mount'
        -- LIBRI / CARTOLERIA
        WHEN name ILIKE '%dizionario%'                                 THEN 'dictionary,reference-book'
        WHEN name ILIKE '%atlante%'                                    THEN 'world-atlas,map-book'
        WHEN name ILIKE '%agenda%'                                     THEN 'planner,agenda-book'
        WHEN name ILIKE '%album da disegno%'                           THEN 'sketchbook,art-paper'
        WHEN name ILIKE '%libro%' OR name ILIKE '%romanzo%' OR name ILIKE '%classico%' OR name ILIKE '%manuale%' OR name ILIKE '%biografia%' OR name ILIKE '%poesie%' OR name ILIKE '%giallo%' OR name ILIKE '%storia%' OR name ILIKE '%arte%' OR name ILIKE '%i promessi%' OR name ILIKE '%guida%'  THEN 'book,reading'
        WHEN name ILIKE '%quaderni%'                                   THEN 'notebooks,stationery'
        WHEN name ILIKE '%penne%'                                      THEN 'pens,ballpoint'
        WHEN name ILIKE '%matite%'                                     THEN 'pencils,drawing'
        WHEN name ILIKE '%pennarelli%'                                 THEN 'markers,colored'
        WHEN name ILIKE '%pastelli%'                                   THEN 'crayons,kids-coloring'
        WHEN name ILIKE '%astuccio%'                                   THEN 'pencil-case,school'
        WHEN name ILIKE '%zaino scuola%' OR name ILIKE '%zaino%'       THEN 'backpack,school-bag'
        WHEN name ILIKE '%risma%' OR name ILIKE '%cartelletta%'        THEN 'paper-stack,office'
        WHEN name ILIKE '%forbici%'                                    THEN 'scissors,stationery'
        WHEN name ILIKE '%colla%'                                      THEN 'glue-stick,craft'
        WHEN name ILIKE '%calcolatrice%'                               THEN 'calculator,scientific'
        WHEN name ILIKE '%righelli%'                                   THEN 'ruler,geometry-set'
        -- GIARDINO
        WHEN name ILIKE '%basilico%'                                   THEN 'basil,herbs'
        WHEN name ILIKE '%rosmarino%'                                  THEN 'rosemary,herbs'
        WHEN name ILIKE '%menta%'                                      THEN 'mint,herbs'
        WHEN name ILIKE '%lavanda%'                                    THEN 'lavender,purple-flower'
        WHEN name ILIKE '%orchidea%'                                   THEN 'orchid,houseplant'
        WHEN name ILIKE '%cactus%'                                     THEN 'cactus,succulent'
        WHEN name ILIKE '%succulenta%'                                 THEN 'succulent,small-plant'
        WHEN name ILIKE '%aloe%'                                       THEN 'aloe-vera,plant'
        WHEN name ILIKE '%bonsai%'                                     THEN 'bonsai,miniature-tree'
        WHEN name ILIKE '%semi%'                                       THEN 'seed-packet,gardening'
        WHEN name ILIKE '%ficus%'                                      THEN 'ficus,indoor-plant'
        WHEN name ILIKE '%pianta%'                                     THEN 'houseplant,potted-plant'
        WHEN name ILIKE '%terriccio%'                                  THEN 'potting-soil,gardening'
        WHEN name ILIKE '%fertilizzante%' OR name ILIKE '%concime%'    THEN 'fertilizer,plant-food'
        WHEN name ILIKE '%annaffiatoio%'                               THEN 'watering-can,garden'
        WHEN name ILIKE '%tubo gomma%'                                 THEN 'garden-hose,watering'
        WHEN name ILIKE '%guanti giardinaggio%'                        THEN 'gardening-gloves,outdoor'
        WHEN name ILIKE '%forbici da potatura%'                        THEN 'pruning-shears,garden'
        WHEN name ILIKE '%vanga%'                                      THEN 'shovel,gardening-tool'
        WHEN name ILIKE '%attrezzi%'                                   THEN 'garden-tools,trowel'
        WHEN name ILIKE '%decespugliatore%' OR name ILIKE '%tagliasiepi%' THEN 'hedge-trimmer,garden-tool'
        WHEN name ILIKE '%soffiatore%'                                 THEN 'leaf-blower,garden'
        WHEN name ILIKE '%carriola%'                                   THEN 'wheelbarrow,garden'
        WHEN name ILIKE '%cassetta%' OR name ILIKE '%fioriera%'        THEN 'flower-planter,wooden-box'
        WHEN name ILIKE '%rete%'                                       THEN 'garden-net,mesh'
        WHEN name ILIKE '%trappola%'                                   THEN 'insect-trap,gardening'
        WHEN name ILIKE '%sacchi%'                                     THEN 'garden-bags,leaves'
        -- BELLEZZA
        WHEN name ILIKE '%crema viso%' OR name ILIKE '%crema antieta%' THEN 'face-cream,skincare'
        WHEN name ILIKE '%crema mani%'                                 THEN 'hand-cream,beauty'
        WHEN name ILIKE '%crema corpo%' OR name ILIKE '%crema solare%' THEN 'body-cream,skincare'
        WHEN name ILIKE '%crema%' OR name ILIKE '%balsamo%' OR name ILIKE '%burro%' THEN 'beauty-cream,skincare'
        WHEN name ILIKE '%olio di argan%'                              THEN 'argan-oil,beauty'
        WHEN name ILIKE '%olio essenziale%'                            THEN 'essential-oil,aromatherapy'
        WHEN name ILIKE '%olio%'                                       THEN 'beauty-oil,skincare'
        WHEN name ILIKE '%siero%'                                      THEN 'face-serum,skincare'
        WHEN name ILIKE '%shampoo%'                                    THEN 'shampoo,hair-care'
        WHEN name ILIKE '%detergente%'                                 THEN 'face-cleanser,skincare'
        WHEN name ILIKE '%bagno schiuma%'                              THEN 'bubble-bath,bath-products'
        WHEN name ILIKE '%maschera viso%'                              THEN 'face-mask,clay-mask'
        WHEN name ILIKE '%scrub%'                                      THEN 'body-scrub,exfoliant'
        WHEN name ILIKE '%profumo donna%' OR name ILIKE '%eau de%'     THEN 'perfume-bottle,fragrance'
        WHEN name ILIKE '%profumo%'                                    THEN 'perfume,cologne'
        WHEN name ILIKE '%rossetto%'                                   THEN 'red-lipstick,makeup'
        WHEN name ILIKE '%smalto%'                                     THEN 'nail-polish,manicure'
        WHEN name ILIKE '%mascara%'                                    THEN 'mascara,eye-makeup'
        WHEN name ILIKE '%ombretti%' OR name ILIKE '%palette%'         THEN 'eyeshadow-palette,makeup'
        WHEN name ILIKE '%fondotinta%'                                 THEN 'foundation,makeup'
        WHEN name ILIKE '%cipria%'                                     THEN 'face-powder,makeup'
        WHEN name ILIKE '%eyeliner%'                                   THEN 'eyeliner,eye-makeup'
        WHEN name ILIKE '%matita labbra%'                              THEN 'lip-liner,makeup'
        WHEN name ILIKE '%set make-up%'                                THEN 'makeup-set,beauty'
        WHEN name ILIKE '%spazzola%'                                   THEN 'hair-brush,wooden-brush'
        WHEN name ILIKE '%tonico%'                                     THEN 'face-toner,skincare'
        -- SPORT / OUTDOOR
        WHEN name ILIKE '%tappetino yoga%' OR name ILIKE '%yoga%'      THEN 'yoga-mat,yoga'
        WHEN name ILIKE '%manubri%'                                    THEN 'dumbbells,gym'
        WHEN name ILIKE '%bilanciere%'                                 THEN 'barbell,weights'
        WHEN name ILIKE '%tuta%'                                       THEN 'tracksuit,sportswear'
        WHEN name ILIKE '%leggings%'                                   THEN 'leggings,activewear'
        WHEN name ILIKE '%scarpe running%' OR name ILIKE '%running%'   THEN 'running-shoes,sport'
        WHEN name ILIKE '%borraccia sport%' OR name ILIKE '%borraccia idratante%' THEN 'sport-bottle,water-bottle'
        WHEN name ILIKE '%borraccia termica%' OR name ILIKE '%borraccia%' THEN 'thermal-bottle,insulated'
        WHEN name ILIKE '%asciugamano sport%'                          THEN 'gym-towel,microfiber'
        WHEN name ILIKE '%elastici fitness%'                           THEN 'resistance-bands,fitness'
        WHEN name ILIKE '%foam roller%' OR name ILIKE '%foam%'         THEN 'foam-roller,recovery'
        WHEN name ILIKE '%corda salto%'                                THEN 'jump-rope,fitness'
        WHEN name ILIKE '%borsone palestra%' OR name ILIKE '%borsone%' THEN 'gym-bag,duffel'
        WHEN name ILIKE '%tenda%'                                      THEN 'camping-tent,outdoor'
        WHEN name ILIKE '%sacco a pelo%'                               THEN 'sleeping-bag,camping'
        WHEN name ILIKE '%zaino trekking%'                             THEN 'hiking-backpack,trekking'
        WHEN name ILIKE '%bastoncini trekking%'                        THEN 'trekking-poles,hiking'
        WHEN name ILIKE '%lampada frontale%' OR name ILIKE '%frontale%' THEN 'headlamp,outdoor-light'
        WHEN name ILIKE '%pentola campeggio%' OR name ILIKE '%fornello%' THEN 'camping-stove,cooking-outdoor'
        WHEN name ILIKE '%materassino%'                                THEN 'sleeping-mat,camping'
        WHEN name ILIKE '%coltello multiuso%' OR name ILIKE '%coltello%' THEN 'swiss-army-knife,multitool'
        WHEN name ILIKE '%telo%'                                       THEN 'emergency-blanket,outdoor'
        WHEN name ILIKE '%kit pronto soccorso%'                        THEN 'first-aid-kit,medical'
        WHEN name ILIKE '%ramponi%'                                    THEN 'ice-crampons,mountaineering'
        -- Fallback per categoria
        ELSE (SELECT slug FROM categories WHERE id = products.category_id) || ',shop'
      END
    ) || '&sig=' || ((abs(hashtext(id::text)) % 999) + 1)
  )
  WHERE seller_id IN (
    SELECT id FROM auth.users WHERE email LIKE '%@piacenza-demo.local'
  );

END $$;

NOTIFY pgrst, 'reload schema';
