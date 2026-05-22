#!/usr/bin/env node
// Genera supabase/migrations/20240101010003_seed_pexels_images.sql con vere foto Pexels SPECIFICHE per ogni prodotto.
//
// Uso:
//   PEXELS_API_KEY=xxx node scripts/fetch-pexels-images.mjs
//
// Strategia: ogni prodotto ottiene una query Pexels su misura derivata dal
// nome italiano (mappato a keyword inglesi precise). Una richiesta Pexels
// per prodotto, per_page=3 cosi' i pochi gruppi residui (es. 2 prodotti
// "salame xyz" diversi) mostrano comunque foto diverse via round-robin.
//
// Throttling: 600ms tra richieste (~100/min). Pexels free e' 200/h: se
// arriva un 429 lo script aspetta 60s e riprova.

import fs from 'node:fs/promises';
import path from 'node:path';

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
if (!PEXELS_API_KEY) {
  console.error('Manca PEXELS_API_KEY nell\'environment.');
  process.exit(1);
}

const SELLERS = {
  s_aliment1: '11111111-1111-1111-1111-aaaaaaaa0001',
  s_aliment2: '11111111-1111-1111-1111-aaaaaaaa0002',
  s_abbigl1:  '11111111-1111-1111-1111-bbbbbbbb0001',
  s_abbigl2:  '11111111-1111-1111-1111-bbbbbbbb0002',
  s_casa1:    '11111111-1111-1111-1111-cccccccc0001',
  s_casa2:    '11111111-1111-1111-1111-cccccccc0002',
  s_elettr1:  '11111111-1111-1111-1111-dddddddd0001',
  s_elettr2:  '11111111-1111-1111-1111-dddddddd0002',
  s_libri1:   '11111111-1111-1111-1111-eeeeeeee0001',
  s_libri2:   '11111111-1111-1111-1111-eeeeeeee0002',
  s_giard1:   '11111111-1111-1111-1111-ffffffff0001',
  s_giard2:   '11111111-1111-1111-1111-ffffffff0002',
  s_bellez1:  '11111111-1111-1111-1111-99999999a001',
  s_bellez2:  '11111111-1111-1111-1111-99999999a002',
  s_sport1:   '11111111-1111-1111-1111-88888888a001',
  s_sport2:   '11111111-1111-1111-1111-88888888a002',
};

// Mappa il nome italiano del prodotto in una query Pexels inglese precisa.
// L'ordine conta: pattern piu' specifici PRIMA dei generici.
function buildQuery(name) {
  const n = name.toLowerCase();
  const rules = [
    // ===== ALIMENTARI: salumi (ogni tipo ha la sua query) =====
    [/coppa piacentina/,            'italian coppa cured meat'],
    [/pancetta piacentina/,         'pancetta italian bacon'],
    [/salame piacentino/,           'italian salami sliced board'],
    [/salame milano/,               'milano salami slices'],
    [/salame/,                      'italian salami plate'],
    [/mortadella/,                  'mortadella bologna italian'],
    [/prosciutto crudo parma/,      'prosciutto di parma ham'],
    [/prosciutto/,                  'italian prosciutto ham'],
    [/bresaola/,                    'bresaola cured beef slices'],
    [/speck/,                       'speck smoked italian ham'],
    // ===== ALIMENTARI: formaggi =====
    [/grana padano/,                'grana padano cheese wheel'],
    [/parmigiano/,                  'parmigiano reggiano cheese'],
    [/pecorino romano/,             'pecorino romano sheep cheese'],
    [/pecorino/,                    'pecorino italian cheese'],
    [/gorgonzola/,                  'gorgonzola blue cheese italian'],
    [/stracchino/,                  'stracchino fresh italian cheese'],
    [/provolone/,                   'provolone italian cheese'],
    [/mozzarella/,                  'mozzarella fresh italian cheese'],
    // ===== ALIMENTARI: pasta =====
    [/tortelli/,                    'italian stuffed pasta tortelli'],
    [/anolini/,                     'italian filled pasta brodo'],
    [/pasta fresca/,                'fresh italian pasta'],
    [/pasta/,                       'italian pasta dish'],
    // ===== ALIMENTARI: frutta =====
    [/pomodor/,                     'cherry tomatoes basket fresh'],
    [/mele golden/,                 'golden delicious apples'],
    [/mele/,                        'red apples basket'],
    [/banan/,                       'ripe bananas bunch'],
    [/arance siciliane/,            'sicilian blood oranges'],
    [/arance/,                      'fresh oranges fruit'],
    [/limon/,                       'fresh yellow lemons'],
    [/fragol/,                      'fresh strawberries bowl'],
    [/uva nera/,                    'dark purple grapes'],
    [/uva/,                         'grapes bunch fresh'],
    [/pere williams/,               'williams pears fruit'],
    [/pere|pera/,                   'fresh pears'],
    // ===== ALIMENTARI: verdura =====
    [/insalata mista/,              'mixed salad greens bowl'],
    [/insalata/,                    'green lettuce salad'],
    [/carot/,                       'fresh orange carrots bunch'],
    [/patate novelle/,              'new baby potatoes'],
    [/patat/,                       'fresh potatoes'],
    [/zucchin/,                     'green zucchini fresh'],
    [/melanzan/,                    'purple eggplants fresh'],
    [/pepero/,                      'bell peppers colorful'],
    [/cipolle dolci/,               'sweet red onions'],
    [/cipoll/,                      'red onions fresh'],

    // ===== ABBIGLIAMENTO donna =====
    [/vestito a fiori/,             'floral summer dress'],
    [/vestito/,                     'elegant women dress'],
    [/camicia di seta bianca/,      'white silk blouse'],
    [/camicia di seta/,             'silk blouse women'],
    [/camicetta crepe/,             'white blouse women elegant'],
    [/camicetta/,                   'women blouse fashion'],
    [/pantaloni eleganti neri/,     'black elegant trousers women'],
    [/gonna midi a pieghe/,         'pleated midi skirt'],
    [/gonna midi/,                  'midi skirt women'],
    [/gonna/,                       'women skirt fashion'],
    [/giacca blazer beige/,         'beige blazer women'],
    [/cardigan in lana beige/,      'beige wool cardigan'],
    [/cardigan/,                    'cardigan knitwear women'],
    [/maglione di lana merino/,     'merino wool sweater'],
    [/maglione girocollo navy/,     'navy blue crewneck sweater'],
    [/maglione/,                    'wool sweater fashion'],
    [/sciarpa di cashmere/,         'cashmere scarf elegant'],
    [/sciarpa/,                     'winter wool scarf'],
    [/borsa a tracolla in pelle/,   'leather crossbody bag women'],
    [/borsa a tracolla/,            'crossbody handbag fashion'],
    [/pochette da sera glitter/,    'evening clutch bag glitter'],
    [/pochette/,                    'evening clutch bag'],
    [/borsetta da sera/,            'evening clutch women'],
    [/borsa/,                       'leather handbag fashion'],
    [/scarpe decollete/,            'black high heels pumps'],
    [/stivali alti in pelle/,       'tall leather boots women'],
    [/stivali/,                     'leather boots fashion'],
    [/cappello panama/,             'panama straw hat summer'],
    [/cintura in pelle marrone/,    'brown leather belt'],

    // ===== ABBIGLIAMENTO uomo / unisex =====
    [/t-shirt cotone bianca/,       'white cotton tshirt mens'],
    [/t-shirt/,                     'tshirt cotton casual'],
    [/jeans slim fit/,              'slim fit jeans denim'],
    [/jeans/,                       'blue jeans denim'],
    [/felpa con cappuccio/,         'grey hoodie sweatshirt mens'],
    [/felpa/,                       'hoodie sweatshirt'],
    [/camicia button.?down/,        'oxford button down shirt blue'],
    [/camicia/,                     'mens shirt fashion'],
    [/giubbino in pelle/,           'biker leather jacket black'],
    [/pantaloni chino/,             'beige chino pants mens'],
    [/sneakers bianche/,            'white sneakers shoes'],
    [/sneakers/,                    'white sneakers fashion'],
    [/scarpe ginnastica/,           'casual sneakers shoes'],
    [/boxer cotone/,                'mens boxer underwear cotton'],
    [/calzini sportivi/,            'athletic sport socks'],
    [/calzini/,                     'cotton socks pile'],
    [/cintura nera/,                'black leather belt mens'],
    [/cintura/,                     'leather belt accessory'],
    [/berretto invernale/,          'winter beanie hat knit'],
    [/cappello/,                    'mens hat fashion'],
    [/polo pique blu/,              'navy blue polo shirt'],
    [/polo/,                        'polo shirt cotton'],
    [/bermuda/,                     'summer cargo shorts mens'],
    [/cappotto invernale/,          'wool winter coat grey'],
    [/cappotto/,                    'mens winter coat'],

    // ===== CASA: tessili e decor =====
    [/lenzuola matrimoniali/,       'white bed sheets bedding'],
    [/lenzuola/,                    'bed sheets bedroom'],
    [/cuscino arredo/,              'decorative cushion sofa'],
    [/cuscino/,                     'pillow decorative bed'],
    [/tovaglia in lino/,            'linen tablecloth dining'],
    [/tovaglia/,                    'tablecloth set table'],
    [/set 4 tovaglioli/,            'linen napkins set table'],
    [/tovaglioli/,                  'cloth napkins set'],
    [/asciugamani spugna/,          'bathroom towels white'],
    [/asciugamani/,                 'bath towels stack'],
    [/coperta in pile/,             'fleece blanket cozy'],
    [/coperta/,                     'warm bed blanket'],
    [/plaid in lana/,               'wool throw blanket'],
    [/plaid/,                       'throw blanket sofa'],
    [/tappeto soggiorno/,           'living room area rug'],
    [/tappeto/,                     'area rug carpet'],
    [/tende oscuranti/,             'blackout curtains modern'],
    [/tende/,                       'window curtains living'],
    [/vaso decorativo ceramica/,    'ceramic decorative vase modern'],
    [/vaso terracotta/,             'terracotta pot plant'],
    [/vaso/,                        'home decor vase'],
    [/cornice digitale/,            'digital photo frame'],
    [/cornice/,                     'picture frame wall'],
    [/lampada da tavolo/,           'designer table lamp'],
    [/lampada led/,                 'led desk lamp modern'],
    [/lampada/,                     'modern interior lamp'],
    [/specchio decorativo/,         'round wall mirror decor'],
    [/specchio/,                    'wall mirror decorative'],
    [/diffusore aromi/,             'aroma diffuser wellness'],
    [/centrotavola/,                'glass centerpiece dining'],

    // ===== CUCINA =====
    [/set pentole antiaderenti/,    'nonstick cookware set'],
    [/pentola campeggio/,           'camping cooking pot'],
    [/pentol/,                      'cookware kitchen pots'],
    [/padella ferro/,               'cast iron skillet pan'],
    [/padel/,                       'kitchen frying pan'],
    [/set tegami/,                  'glass baking dishes pyrex'],
    [/tegam/,                       'kitchen baking dish'],
    [/set 12 posate/,               'silverware set cutlery'],
    [/posat/,                       'cutlery dining silver'],
    [/coltelli da cucina/,          'kitchen knife set chef'],
    [/coltell/,                     'kitchen knives'],
    [/macchina caffe espresso/,     'espresso machine kitchen'],
    [/macinacaffe/,                 'manual coffee grinder'],
    [/macchina caffe/,              'coffee machine kitchen'],
    [/frullatore/,                  'kitchen blender'],
    [/tritatutto/,                  'electric food processor'],
    [/spremiagrumi/,                'electric citrus juicer'],
    [/tostapane/,                   'modern toaster bread'],
    [/bicchieri vino/,              'wine glasses set'],
    [/bicchier/,                    'drinking glasses set'],
    [/caraffa filtrante/,           'water filter pitcher'],
    [/caraffa/,                     'glass water pitcher'],
    [/bilancia da cucina/,          'kitchen digital scale baking'],
    [/tagliere bambu/,              'bamboo cutting board'],
    [/tagliere/,                    'wooden cutting board'],

    // ===== ELETTRONICA =====
    [/cuffie bluetooth wireless/,   'wireless bluetooth headphones'],
    [/cuffie/,                      'over ear headphones black'],
    [/auricolari true wireless/,    'tws wireless earbuds white'],
    [/auricolari/,                  'wireless earbuds case'],
    [/custodia airpods/,            'airpods case silicone'],
    [/caricabatterie usb.?c/,       'usb c charger 20w'],
    [/caricatore wireless/,         'qi wireless charger pad'],
    [/caricatore auto/,             'car usb charger'],
    [/caricabatterie|caricatore/,   'usb wall charger adapter'],
    [/powerbank/,                   'portable power bank'],
    [/cavo usb.?c/,                 'usb c braided cable'],
    [/cavo lightning/,              'iphone lightning cable'],
    [/cavo/,                        'usb charging cable'],
    [/mouse wireless/,              'wireless ergonomic mouse'],
    [/mouse/,                       'computer mouse modern'],
    [/tastiera meccanica/,          'mechanical keyboard rgb gaming'],
    [/tastiera/,                    'computer keyboard'],
    [/webcam/,                      'webcam hd computer'],
    [/microfono usb/,               'usb studio microphone podcast'],
    [/microfono/,                   'professional microphone'],
    [/speaker bluetooth/,           'bluetooth portable speaker'],
    [/speaker/,                     'wireless speaker audio'],
    [/hub usb/,                     'usb hub multiport adapter'],
    [/adattatore hdmi/,             'hdmi adapter cable'],
    [/adattatore lightning/,        'lightning audio adapter'],
    [/adattatore/,                  'tech adapter accessory'],
    [/ssd esterno/,                 'external ssd portable drive'],
    [/memory card/,                 'micro sd memory card'],
    [/cover iphone/,                'iphone clear case'],
    [/cover samsung/,               'samsung galaxy phone case'],
    [/cover/,                       'smartphone phone case'],
    [/custodia/,                    'phone accessory case'],
    [/pellicola vetro/,             'tempered glass screen protector'],
    [/smartwatch/,                  'smartwatch fitness wearable'],
    [/bracciale fitness/,           'fitness tracker wristband'],
    [/selfie stick/,                'selfie stick tripod'],
    [/anello luminoso/,             'ring light photography'],
    [/lampada led con usb/,         'usb led desk lamp office'],
    [/stand per laptop/,            'aluminum laptop stand'],
    [/pad mouse/,                   'large gaming mousepad desk'],
    [/supporto smartphone/,         'magnetic car phone holder'],

    // ===== LIBRI =====
    [/dizionario/,                  'dictionary book open reference'],
    [/atlante geografico/,          'world atlas geography book'],
    [/agenda 2026/,                 'planner agenda diary'],
    [/album da disegno/,            'sketchbook drawing paper art'],
    [/romanzo italiano/,            'italian novel literature'],
    [/storia di piacenza/,          'history book vintage italy'],
    [/libro per bambini/,           'illustrated childrens book colorful'],
    [/guida emilia/,                'italy travel guidebook'],
    [/i promessi sposi/,            'classic italian literature manzoni'],
    [/biografia di leonardo/,       'leonardo da vinci biography book'],
    [/cucina italiana/,             'italian cookbook recipe'],
    [/raccolta poesie/,             'poetry book open'],
    [/romanzo giallo/,              'crime mystery novel book'],
    [/manuale di fotografia/,       'photography book guide'],
    [/arte del rinascimento/,       'renaissance art book illustrated'],
    [/informatica base/,            'computer book learning beginner'],
    [/manuale di giardinaggio/,     'gardening book guide'],
    [/libro|romanzo|manuale|classico|biografia|poesie|giallo|storia|arte|guida/, 'open book reading'],
    [/quaderni/,                    'school notebooks stack'],
    [/penne biro/,                  'blue ballpoint pens set'],
    [/penne/,                       'pens stationery office'],
    [/matite hb/,                   'hb graphite pencils sharpened'],
    [/matite/,                      'drawing pencils set'],
    [/pennarelli/,                  'colored markers art set'],
    [/pastelli a cera/,             'wax crayons children art'],
    [/astuccio/,                    'school pencil case stationery'],
    [/zaino scuola/,                'school backpack student kids'],
    [/risma carta/,                 'white printer paper ream'],
    [/forbici/,                     'craft scissors stationery'],
    [/colla stick/,                 'glue stick craft school'],
    [/calcolatrice scientifica/,    'scientific calculator school'],
    [/righelli/,                    'rulers geometry set'],
    [/cartelletta/,                 'document folder office archive'],

    // ===== GIARDINO =====
    [/pianta basilico/,             'basil plant herb pot'],
    [/pianta rosmarino/,            'rosemary plant herb pot'],
    [/pianta menta/,                'mint plant fresh herb'],
    [/lavanda profumata/,           'lavender plant purple flowers'],
    [/orchidea/,                    'white orchid flower houseplant'],
    [/cactus mix/,                  'cactus collection small pots'],
    [/cactus/,                      'cactus succulent plant'],
    [/succulenta/,                  'succulent plant small pot'],
    [/aloe vera/,                   'aloe vera plant pot'],
    [/bonsai/,                      'bonsai miniature tree pot'],
    [/semi pomodoro/,               'tomato seed packet gardening'],
    [/semi insalata/,               'lettuce seed packet gardening'],
    [/semi/,                        'seed packets garden'],
    [/ficus benjamin/,              'ficus benjamina indoor plant'],
    [/pianta/,                      'potted houseplant green'],
    [/terriccio/,                   'potting soil bag gardening'],
    [/fertilizzante|concime/,       'plant fertilizer bottle gardening'],
    [/annaffiatoio/,                'metal watering can garden'],
    [/tubo gomma/,                  'green garden hose coiled'],
    [/guanti giardinaggio/,         'gardening gloves outdoor'],
    [/forbici da potatura/,         'pruning shears garden'],
    [/vanga/,                       'garden shovel digging tool'],
    [/set attrezzi/,                'garden tools set rake trowel'],
    [/decespugliatore/,             'brush cutter outdoor power tool'],
    [/tagliasiepi/,                 'hedge trimmer electric garden'],
    [/soffiatore foglie/,           'leaf blower autumn garden'],
    [/carriola/,                    'wheelbarrow gardening yard'],
    [/cassetta legno/,              'wooden flower planter box'],
    [/fioriera/,                    'wood planter box flowers'],
    [/rete ombreggiante/,           'shade net garden green'],
    [/trappola insetti/,            'sticky insect trap garden'],
    [/sacchi raccolta/,             'garden waste bags leaves'],

    // ===== BELLEZZA =====
    [/crema viso bio/,              'organic face cream jar'],
    [/crema antieta/,               'anti aging cream luxury jar'],
    [/crema mani/,                  'hand cream tube'],
    [/crema corpo/,                 'body lotion bottle moisturizer'],
    [/crema solare/,                'sunscreen bottle beach'],
    [/crema/,                       'beauty cream jar skincare'],
    [/balsamo riparatore/,          'hair conditioner bottle salon'],
    [/burro\s+(di\s+)?karite/,      'shea butter jar natural beauty'],
    [/olio di argan/,               'argan oil amber bottle beauty'],
    [/olio essenziale lavanda/,     'lavender essential oil dropper'],
    [/olio essenziale/,             'essential oil aromatherapy'],
    [/olio/,                        'beauty oil bottle skincare'],
    [/siero vitamina/,              'vitamin c face serum dropper'],
    [/siero/,                       'face serum bottle dropper'],
    [/shampoo/,                     'shampoo bottle haircare'],
    [/detergente viso/,             'face cleanser foam skincare'],
    [/bagno schiuma/,               'bubble bath bottle bathroom'],
    [/maschera viso argilla/,       'clay face mask beauty'],
    [/maschera viso/,               'face mask beauty skincare'],
    [/scrub corpo/,                 'body scrub exfoliant jar'],
    [/profumo donna/,               'womens perfume bottle floral'],
    [/profumo uomo/,                'mens cologne bottle wooden'],
    [/profumo unisex/,              'unisex perfume bottle minimalist'],
    [/eau de toilette/,             'perfume spray bottle glass'],
    [/profumo|eau de/,              'perfume bottle elegant'],
    [/rossetto/,                    'red lipstick makeup'],
    [/smalto/,                      'red nail polish bottle'],
    [/mascara/,                     'black mascara tube makeup'],
    [/palette ombretti/,            'eyeshadow palette nude makeup'],
    [/palette/,                     'makeup eyeshadow palette'],
    [/fondotinta liquido/,          'liquid foundation bottle makeup'],
    [/cipria/,                      'face powder compact makeup'],
    [/eyeliner liquido/,            'black liquid eyeliner makeup'],
    [/matita labbra/,               'nude lip liner pencil'],
    [/set make-up/,                 'makeup brush set kit'],
    [/spazzola in legno/,           'wooden hair brush natural'],
    [/tonico viso/,                 'face toner bottle skincare'],

    // ===== SPORT / OUTDOOR =====
    [/tappetino yoga/,              'yoga mat fitness purple'],
    [/manubri 5kg/,                 'dumbbells 5kg pair gym'],
    [/manubri/,                     'dumbbells weights gym'],
    [/bilanciere fitness/,          'barbell weight plates gym'],
    [/tuta da ginnastica donna/,    'womens tracksuit sportswear'],
    [/tuta da ginnastica uomo/,     'mens tracksuit sportswear'],
    [/tuta/,                        'tracksuit athletic wear'],
    [/scarpe running uomo/,         'mens running shoes athletic'],
    [/scarpe running donna/,        'womens running shoes athletic'],
    [/scarponcini trekking/,        'hiking boots mountain'],
    [/borraccia sport/,             'sport water bottle athletic'],
    [/borraccia termica/,           'thermal stainless steel flask'],
    [/borraccia idratante/,         'hydration bladder backpack'],
    [/asciugamano sport/,           'microfiber gym towel'],
    [/elastici fitness/,            'resistance bands set fitness'],
    [/foam roller/,                 'foam roller massage recovery'],
    [/corda salto/,                 'jump rope fitness training'],
    [/magliette sport/,             'athletic sport tshirts dryfit'],
    [/leggings sport/,              'womens sport leggings yoga'],
    [/borsone palestra/,            'black gym duffel bag'],
    [/tenda 2 posti/,               'two person camping tent'],
    [/sacco a pelo/,                'sleeping bag camping winter'],
    [/zaino trekking/,              'large hiking backpack mountain'],
    [/bastoncini trekking/,         'aluminum trekking poles hiking'],
    [/lampada frontale/,            'led headlamp camping hiking'],
    [/fornello.*gas/,               'portable camping gas stove'],
    [/materassino/,                 'self inflating sleeping pad'],
    [/coltello multiuso/,           'swiss army multitool knife'],
    [/telo emergenza/,              'emergency thermal blanket gold'],
    [/kit pronto soccorso/,         'first aid kit outdoor medical'],
    [/ramponi/,                     'ice crampons mountaineering'],

    // Fallback
    [/.*/,                          'product retail shop'],
  ];
  for (const [re, query] of rules) {
    if (re.test(n)) return query;
  }
  return 'product retail shop';
}

async function fetchPexels(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=square`;
  const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
  if (res.status === 429) {
    console.error('  Rate limited. Sleeping 60s...');
    await new Promise((r) => setTimeout(r, 60_000));
    return fetchPexels(query);
  }
  if (!res.ok) {
    console.error(`  Pexels error ${res.status} for "${query}"`);
    return [];
  }
  const data = await res.json();
  return (data.photos ?? [])
    .map((p) => p.src?.large ?? p.src?.medium ?? p.src?.original)
    .filter(Boolean);
}

async function main() {
  const sqlFile = path.resolve('supabase/migrations/20240101010001_seed_piacenza_stores.sql');
  const raw = await fs.readFile(sqlFile, 'utf-8');
  const sellerNames = Object.keys(SELLERS).join('|');
  const productRe = new RegExp(`\\((${sellerNames}),\\s*c_\\w+,\\s*'((?:[^']|'')+)'`, 'g');

  const products = [];
  for (const m of raw.matchAll(productRe)) {
    products.push({ sellerId: SELLERS[m[1]], name: m[2].replace(/''/g, "'") });
  }
  console.log(`Parsed ${products.length} prodotti dal seed 001.`);

  // Raggruppa per query (alcuni prodotti possono comunque condividere la query
  // se hanno il nome generico - es. "Salame Milano" vs "Salame piacentino" =
  // due query diverse, ma "Salumi extra" e "Salame mio" finirebbero su /salame/).
  const groups = new Map();
  for (const p of products) {
    const q = buildQuery(p.name);
    if (!groups.has(q)) groups.set(q, []);
    groups.get(q).push(p);
  }
  console.log(`Query Pexels uniche: ${groups.size}`);

  const assignments = [];
  let queryIdx = 0;
  for (const [query, group] of groups) {
    queryIdx++;
    process.stdout.write(`[${queryIdx}/${groups.size}] "${query}" (${group.length})... `);
    const photos = await fetchPexels(query);
    console.log(photos.length > 0 ? `${photos.length} foto` : 'NESSUNA FOTO');
    group.forEach((p, idx) => {
      const url = photos.length > 0 ? photos[idx % photos.length] : null;
      assignments.push({ ...p, url, query });
    });
    await new Promise((r) => setTimeout(r, 600));
  }

  // Avviso sui prodotti che hanno ancora il fallback generico
  const fallbackCount = assignments.filter((a) => a.query === 'product retail shop').length;
  if (fallbackCount > 0) {
    console.warn(`\n${fallbackCount} prodotti finiti sulla query fallback "product retail shop".`);
  }

  const lines = [
    '-- Seed 003: foto Pexels SPECIFICHE per ogni prodotto demo',
    '-- Generato da scripts/fetch-pexels-images.mjs',
    '',
    'DO $$',
    'BEGIN',
  ];
  let written = 0;
  for (const a of assignments) {
    if (!a.url) continue;
    const safeName = a.name.replace(/'/g, "''");
    const imagesJson = JSON.stringify([a.url]).replace(/'/g, "''");
    lines.push(
      `  UPDATE products SET images = '${imagesJson}'::jsonb WHERE seller_id = '${a.sellerId}' AND name = '${safeName}';`
    );
    written++;
  }
  lines.push('END $$;', '', "NOTIFY pgrst, 'reload schema';", '');

  const outPath = path.resolve('supabase/migrations/20240101010003_seed_pexels_images.sql');
  await fs.writeFile(outPath, lines.join('\n'));
  console.log(`\nScritto ${outPath} con ${written} UPDATE.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
