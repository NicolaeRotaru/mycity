#!/usr/bin/env node
// Genera seeds/003_pexels_images.sql con vere foto da Pexels per i prodotti demo.
//
// Uso:
//   PEXELS_API_KEY=xxx node scripts/fetch-pexels-images.mjs
//
// Parsing: legge seeds/001_piacenza_stores.sql, estrae (seller_var, nome) per
// ogni prodotto, mappa il nome a una query inglese pi  efficace per Pexels,
// raggruppa per query, fa UNA sola chiamata Pexels per query (con per_page=5)
// e distribuisce le foto round-robin ai prodotti dello stesso gruppo.
// Risultato: ~80 chiamate API totali per 240 prodotti (sotto il limite di
// 200/ora del piano gratuito di Pexels), e prodotti dello stesso tipo non
// finiscono tutti con la stessa identica foto.

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

// Mappa il nome del prodotto a una query inglese specifica per Pexels.
// L'ordine conta: i match piu' specifici vanno prima dei piu' generici.
function buildQuery(name) {
  const n = name.toLowerCase();
  const rules = [
    // Frutta e verdura
    [/pomodor/,                       'cherry tomatoes fresh'],
    [/insalata/,                      'fresh salad lettuce'],
    [/carot/,                         'fresh carrots'],
    [/patat/,                         'potatoes vegetable'],
    [/mele/,                          'red apples fresh'],
    [/banan/,                         'bananas yellow fruit'],
    [/arance/,                        'orange citrus fruit'],
    [/limon/,                         'lemons yellow fruit'],
    [/zucchin/,                       'green zucchini'],
    [/melanzan/,                      'eggplant purple'],
    [/pepero/,                        'bell peppers colorful'],
    [/fragol/,                        'fresh strawberries'],
    [/uva/,                           'grapes purple fruit'],
    [/pere|pera/,                     'pears fresh fruit'],
    [/cipoll/,                        'red onions fresh'],
    // Salumi e formaggi
    [/coppa|pancetta/,                'italian cured meat salami'],
    [/salame/,                        'italian salami sliced'],
    [/mortadella/,                    'mortadella italian deli'],
    [/prosciutto/,                    'prosciutto italian ham'],
    [/bresaola/,                      'bresaola cured beef'],
    [/speck/,                         'speck smoked ham'],
    [/grana/,                         'parmesan cheese wedge'],
    [/pecorino/,                      'pecorino aged cheese'],
    [/gorgonzola/,                    'gorgonzola blue cheese'],
    [/stracchino|mozzarella/,         'mozzarella fresh italian cheese'],
    [/provolone/,                     'provolone italian cheese'],
    [/tortelli|anolini/,              'fresh italian pasta'],
    [/pasta/,                         'italian pasta'],
    // Abbigliamento
    [/vestito/,                       'summer dress fashion'],
    [/camicia di seta|camicetta/,     'silk blouse white shirt'],
    [/camicia/,                       'mens shirt fashion'],
    [/pantaloni elegant/,             'elegant womens trousers'],
    [/blazer/,                        'blazer jacket fashion'],
    [/borsa a tracolla|pochette/,     'leather handbag fashion'],
    [/borsa/,                         'fashion handbag'],
    [/decollete/,                     'high heels womens shoes'],
    [/stivali/,                       'leather boots fashion'],
    [/sciarpa/,                       'cashmere scarf winter'],
    [/maglione/,                      'wool sweater knitwear'],
    [/cardigan/,                      'beige cardigan knitwear'],
    [/gonna/,                         'midi skirt fashion'],
    [/cappello panama/,               'straw panama hat'],
    [/cappello|berretto/,             'winter hat'],
    [/t-shirt|polo|magliette/,        'mens tshirt casual'],
    [/jeans/,                         'blue jeans denim'],
    [/felpa/,                         'hoodie sweatshirt mens'],
    [/giubbino/,                      'leather jacket biker'],
    [/cappotto/,                      'wool coat winter'],
    [/chino|bermuda/,                 'chino pants casual'],
    [/pantaloni/,                     'trousers fashion'],
    [/sneakers/,                      'white sneakers shoes'],
    [/scarpe running|running/,        'running shoes sport'],
    [/scarpe|scarpon/,                'shoes footwear'],
    [/boxer/,                         'mens underwear'],
    [/calzini/,                       'sport socks'],
    [/cintura/,                       'leather belt accessory'],
    // Casa e cucina
    [/lenzuola/,                      'bed sheets bedding white'],
    [/asciugamani/,                   'bathroom towels'],
    [/cuscino/,                       'decorative cushion pillow'],
    [/coperta|plaid/,                 'cozy blanket throw'],
    [/tovaglia/,                      'linen tablecloth dining'],
    [/tovaglioli/,                    'linen napkins table'],
    [/tappeto/,                       'living room rug'],
    [/tende/,                         'window curtains modern'],
    [/vaso/,                          'ceramic vase home decor'],
    [/cornice/,                       'picture frame wall'],
    [/lampada/,                       'modern table lamp'],
    [/specchio/,                      'wall mirror decor'],
    [/diffusore/,                     'aroma diffuser wellness'],
    [/centrotavola/,                  'table centerpiece decor'],
    [/pentol|padel|tegam/,            'cookware kitchen pots'],
    [/posat/,                         'silverware cutlery'],
    [/coltell/,                       'kitchen knives chef'],
    [/macchina caffe|espresso/,       'espresso machine modern'],
    [/macinacaffe/,                   'coffee grinder beans'],
    [/frullatore/,                    'kitchen blender'],
    [/tritatutto/,                    'food processor kitchen'],
    [/spremiagrumi/,                  'citrus juicer kitchen'],
    [/tostapane/,                     'modern toaster kitchen'],
    [/bicchier/,                      'wine glasses set'],
    [/caraffa/,                       'glass water pitcher'],
    [/bilancia/,                      'kitchen scale baking'],
    [/tagliere/,                      'wooden cutting board'],
    // Elettronica
    [/cuffie/,                        'over ear headphones'],
    [/auricolari|airpods/,            'wireless earbuds'],
    [/caricabatterie|caricatore/,     'usb charger adapter'],
    [/powerbank/,                     'portable powerbank'],
    [/cavo/,                          'usb charging cable'],
    [/mouse/,                         'wireless mouse desk'],
    [/tastiera/,                      'mechanical keyboard'],
    [/webcam/,                        'webcam video call'],
    [/microfono/,                     'usb microphone podcast'],
    [/speaker/,                       'bluetooth speaker portable'],
    [/hub|adattatore/,                'usb hub accessories'],
    [/ssd/,                           'ssd external drive'],
    [/memory/,                        'memory card sd'],
    [/cover iphone/,                  'iphone clear case'],
    [/cover samsung/,                 'samsung phone case'],
    [/cover|custodia/,                'phone case accessories'],
    [/pellicola/,                     'screen protector glass'],
    [/smartwatch/,                    'smartwatch wearable tech'],
    [/bracciale fitness/,             'fitness tracker wearable'],
    [/selfie/,                        'selfie stick tripod'],
    [/anello luminoso|lampada led/,   'ring light photography'],
    [/stand/,                         'laptop stand desk'],
    [/pad mouse|mousepad/,            'mousepad gaming setup'],
    [/supporto/,                      'phone car holder'],
    // Libri / cartoleria
    [/dizionario|atlante/,            'open reference book'],
    [/agenda/,                        'planner agenda diary'],
    [/album da disegno/,              'sketchbook art paper'],
    [/libro|romanzo|classico|manuale|biografia|poesie|giallo|storia|arte|i promessi|guida/, 'open book reading'],
    [/quaderni/,                      'notebooks stationery'],
    [/penne/,                         'ballpoint pens'],
    [/matite/,                        'pencils drawing'],
    [/pennarelli/,                    'colored markers art'],
    [/pastelli/,                      'wax crayons kids'],
    [/astuccio/,                      'pencil case school'],
    [/zaino scuola|zaino/,            'school backpack'],
    [/risma|cartelletta/,             'office paper documents'],
    [/forbici/,                       'scissors stationery'],
    [/colla/,                         'glue stick craft'],
    [/calcolatrice/,                  'scientific calculator'],
    [/righelli/,                      'ruler geometry'],
    // Giardino
    [/basilico/,                      'fresh basil herbs'],
    [/rosmarino/,                     'rosemary herbs plant'],
    [/menta/,                         'fresh mint herbs'],
    [/lavanda/,                       'lavender purple flowers'],
    [/orchidea/,                      'orchid flower houseplant'],
    [/cactus/,                        'cactus succulent plant'],
    [/succulenta/,                    'succulent plant pot'],
    [/aloe/,                          'aloe vera plant'],
    [/bonsai/,                        'bonsai tree miniature'],
    [/semi/,                          'seed packets gardening'],
    [/ficus/,                         'ficus indoor plant'],
    [/pianta/,                        'green houseplant pot'],
    [/terriccio/,                     'potting soil gardening'],
    [/fertilizzante|concime/,         'plant fertilizer garden'],
    [/annaffiatoio/,                  'watering can garden'],
    [/tubo gomma/,                    'green garden hose'],
    [/guanti giardinaggio/,           'gardening gloves outdoor'],
    [/forbici da potatura/,           'pruning shears garden'],
    [/vanga/,                         'shovel gardening tool'],
    [/attrezzi/,                      'gardening tools set'],
    [/decespugliatore|tagliasiepi/,   'hedge trimmer garden'],
    [/soffiatore/,                    'leaf blower outdoor'],
    [/carriola/,                      'wheelbarrow garden'],
    [/cassetta|fioriera/,             'wooden flower planter'],
    [/rete/,                          'garden mesh net'],
    [/trappola/,                      'insect trap garden'],
    [/sacchi/,                        'garden waste bags'],
    // Bellezza
    [/crema viso|crema antieta/,      'face cream skincare bottle'],
    [/crema mani/,                    'hand cream beauty'],
    [/crema corpo|crema solare/,      'body lotion skincare'],
    [/crema|balsamo|burro/,           'beauty cream jar'],
    [/olio di argan/,                 'argan oil beauty bottle'],
    [/olio essenziale/,               'essential oil aromatherapy'],
    [/olio/,                          'beauty oil glass bottle'],
    [/siero/,                         'face serum dropper'],
    [/shampoo/,                       'shampoo hair care bottle'],
    [/detergente/,                    'face cleanser skincare'],
    [/bagno schiuma/,                 'bubble bath beauty'],
    [/maschera viso/,                 'face mask clay beauty'],
    [/scrub/,                         'body scrub exfoliating'],
    [/profumo donna|eau de/,          'perfume bottle elegant'],
    [/profumo/,                       'perfume cologne fragrance'],
    [/rossetto/,                      'red lipstick makeup'],
    [/smalto/,                        'nail polish red'],
    [/mascara/,                       'mascara eye makeup'],
    [/palette ombretti|ombretti/,     'eyeshadow palette makeup'],
    [/palette/,                       'makeup palette'],
    [/fondotinta/,                    'foundation makeup bottle'],
    [/cipria/,                        'face powder makeup'],
    [/eyeliner/,                      'eyeliner pencil makeup'],
    [/matita labbra/,                 'lip liner pencil'],
    [/set make-up/,                   'makeup set beauty'],
    [/spazzola/,                      'wooden hair brush'],
    [/tonico/,                        'toner skincare bottle'],
    // Sport / outdoor
    [/tappetino yoga|yoga/,           'yoga mat fitness'],
    [/manubri/,                       'dumbbells gym weights'],
    [/bilanciere/,                    'barbell weights gym'],
    [/tuta/,                          'tracksuit sportswear'],
    [/leggings/,                      'leggings activewear yoga'],
    [/borraccia sport|borraccia idratante/, 'sport water bottle'],
    [/borraccia termica|borraccia/,   'thermal insulated bottle'],
    [/asciugamano sport/,             'gym microfiber towel'],
    [/elastici fitness/,              'resistance bands fitness'],
    [/foam roller|foam/,              'foam roller recovery'],
    [/corda salto/,                   'jump rope fitness'],
    [/borsone palestra|borsone/,      'gym duffel bag'],
    [/tenda/,                         'camping tent outdoor'],
    [/sacco a pelo/,                  'sleeping bag camping'],
    [/zaino trekking/,                'hiking backpack mountain'],
    [/bastoncini trekking/,           'trekking poles hiking'],
    [/lampada frontale|frontale/,     'headlamp outdoor hiking'],
    [/pentola campeggio|fornello/,    'camping stove cookware'],
    [/materassino/,                   'camping sleeping pad'],
    [/coltello multiuso|coltello/,    'swiss army knife multitool'],
    [/telo/,                          'emergency blanket outdoor'],
    [/kit pronto soccorso/,           'first aid kit medical'],
    [/ramponi/,                       'ice crampons mountaineering'],
    [/scarponcini/,                   'hiking boots mountain'],
  ];
  for (const [re, query] of rules) {
    if (re.test(n)) return query;
  }
  return 'product retail shop';
}

async function fetchPexels(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=square`;
  const res = await fetch(url, {
    headers: { Authorization: PEXELS_API_KEY },
  });
  if (!res.ok) {
    console.error(`  Pexels error ${res.status} for "${query}"`);
    if (res.status === 429) {
      console.error('  Rate limited. Sleeping 60s...');
      await new Promise((r) => setTimeout(r, 60_000));
      return fetchPexels(query);
    }
    return [];
  }
  const data = await res.json();
  return (data.photos ?? [])
    .map((p) => p.src?.large ?? p.src?.medium ?? p.src?.original)
    .filter(Boolean);
}

async function main() {
  const sqlFile = path.resolve('seeds/001_piacenza_stores.sql');
  const raw = await fs.readFile(sqlFile, 'utf-8');

  // Trova ogni tupla VALUES che inizia con uno dei seller_var noti.
  const sellerNames = Object.keys(SELLERS).join('|');
  const productRe = new RegExp(
    `\\((${sellerNames}),\\s*c_\\w+,\\s*'((?:[^']|'')+)'`,
    'g'
  );

  const products = [];
  for (const m of raw.matchAll(productRe)) {
    const sellerVar = m[1];
    const name = m[2].replace(/''/g, "'");
    products.push({ sellerId: SELLERS[sellerVar], name });
  }
  console.log(`Parsed ${products.length} prodotti dal seed 001.`);

  // Raggruppa per query
  const groups = new Map();
  for (const p of products) {
    const q = buildQuery(p.name);
    if (!groups.has(q)) groups.set(q, []);
    groups.get(q).push(p);
  }
  console.log(`Query Pexels uniche: ${groups.size}`);

  // Fetch + assegnazione round-robin
  const assignments = [];
  let queryIdx = 0;
  for (const [query, group] of groups) {
    queryIdx++;
    process.stdout.write(`[${queryIdx}/${groups.size}] "${query}" (${group.length} prodotti)... `);
    const photos = await fetchPexels(query);
    console.log(photos.length > 0 ? `${photos.length} foto` : 'nessuna foto');
    group.forEach((p, idx) => {
      const url = photos.length > 0 ? photos[idx % photos.length] : null;
      assignments.push({ ...p, url });
    });
    // Throttle leggero: ~2 req/sec (sotto i 200/h di Pexels free)
    await new Promise((r) => setTimeout(r, 550));
  }

  // Genera SQL
  const lines = [
    '-- Seed 003: vere foto da Pexels per i prodotti demo (sovrascrive il seed 002)',
    '-- Generato automaticamente da scripts/fetch-pexels-images.mjs',
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

  const outPath = path.resolve('seeds/003_pexels_images.sql');
  await fs.writeFile(outPath, lines.join('\n'));
  console.log(`\nScritto ${outPath} con ${written} UPDATE.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
