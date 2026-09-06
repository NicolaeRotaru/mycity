/**
 * 6/9/2026 — IL CARRELLO E LA CASSA SI CONTRADDICEVANO IN QUATTRO PUNTI, TUTTI SUI SOLDI.
 *
 * Sono due schermate una dopo l'altra, e chi compra le legge come una cosa sola. Quando il numero
 * cambia fra l'una e l'altra, la persona non pensa «si è aggiornato»: pensa che ci sia un errore, e
 * torna indietro a controllare. È il momento in cui il carrello si abbandona.
 *
 *   ① IL CONTATORE. Il carrello sommava i PEZZI, la cassa contava le RIGHE. Con due filoni e tre
 *      focacce: «5 articoli» di qua, «2 articoli» di là.
 *   ② LA SPEDIZIONE. Le due pagine chiamavano la stessa funzione con ingressi diversi: il carrello
 *      passava sempre le coordinate a `null` (tariffa fissa 4,90 €), la cassa passava quelle
 *      dell'indirizzo salvato (2,50 € + 1,20 € al km). Negozio in centro, cliente a 2,9 km: 4,90
 *      qui, 6,00 un tocco dopo.
 *   ③ IL PREZZO. Il carrello leggeva dal database solo la scorta e mostrava il prezzo congelato nel
 *      browser al momento in cui il prodotto era stato aggiunto; la cassa rileggeva prezzo e
 *      promozioni attive. Un prezzo ritoccato dal negozio, o una promo partita, e il totale
 *      cambiava all'ultimo passo.
 *   ④ LE VARIANTI. Nel riepilogo della cassa «Maglietta (M)» e «Maglietta (L)» erano due righe
 *      identiche, e avevano perfino la stessa chiave di React.
 *
 * Questa prova legge il sorgente delle due pagine: sono difetti di gravità minore, e il manuale del
 * lotto ammette la verifica sul sorgente. Diventa rossa se qualcuno rimette la divergenza.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const leggi = (p: string) => readFileSync(p, 'utf8');

const CARRELLO = leggi('app/cart/page.tsx');
const CASSA = leggi('app/checkout/page.tsx');
const RIEPILOGO = leggi('components/checkout/CartGroupsList.tsx');
const BARRA_PASSI = leggi('components/checkout/StepIndicator.tsx');

describe('① quanti articoli ci sono nel carrello: una risposta sola', () => {
  it('la cassa conta i pezzi con la stessa funzione del carrello, non le righe', () => {
    expect(CASSA, 'la cassa contava le righe: `{cart.length} articoli`').not.toMatch(
      /\{cart\.length\}\s*articoli/,
    );
    expect(CASSA).toContain('cartCount(cart)');
    expect(CARRELLO).toContain('cartCount(righe)');
  });
});

describe('② la spedizione: stessa funzione, stessi ingressi', () => {
  /** La chiamata a `shippingForEuro` dentro il carrello, presa per intero. */
  const chiamata = CARRELLO.slice(
    CARRELLO.indexOf('+ shippingForEuro({'),
    CARRELLO.indexOf('pickupInStore: false,', CARRELLO.indexOf('+ shippingForEuro({')),
  );

  it('la chiamata del carrello esiste ancora: senza, questa prova non misura niente', () => {
    expect(chiamata.length, 'il carrello non chiama più `shippingForEuro`').toBeGreaterThan(20);
  });

  it('il carrello non passa più le coordinate a `null` scritte a mano', () => {
    for (const campo of ['storeLat', 'storeLng', 'deliveryLat', 'deliveryLng']) {
      expect(
        chiamata,
        `il carrello passa ancora \`${campo}: null\`: senza coordinate la funzione ripiega sui 4,90 € fissi mentre la cassa calcola sulla distanza`,
      ).not.toMatch(new RegExp(`${campo}:\\s*null\\s*,`));
    }
  });

  it('le coordinate arrivano da dove sta il negozio e da dove consegniamo', () => {
    expect(chiamata).toContain('dovEIlNegozio');
    expect(chiamata).toContain('doveConsegniamo');
    // Le due letture che riempiono quelle due: le stesse tabelle che legge la cassa.
    expect(CARRELLO).toContain("from('user_addresses')");
    expect(CARRELLO).toContain('store_lat, store_lng');
    expect(CASSA).toContain("from('user_addresses')");
  });

  it('il commento che diceva il falso sulla cassa non c\'è più', () => {
    expect(
      CARRELLO,
      'il commento affermava che la cassa aspetta che la persona scriva l\'indirizzo: non è vero, quello salvato ce l\'ha già',
    ).not.toContain('esattamente come\n   * fa il checkout prima che la persona lo scriva');
  });
});

describe('③ il prezzo mostrato è quello che verrà addebitato', () => {
  it('il carrello rilegge il prezzo dal database, non solo la scorta', () => {
    expect(CARRELLO, 'la lettura chiedeva soltanto `id, stock`').toContain("select('id, stock, price')");
  });

  it('e ci applica le promozioni attive con la stessa funzione della cassa', () => {
    for (const f of ['fetchActiveDiscounts', 'discountedUnitCents']) {
      expect(CARRELLO, `il carrello non usa \`${f}\`, la cassa sì: i due totali possono divergere`).toContain(f);
      expect(CASSA).toContain(f);
    }
  });

  it('il totale e i gruppi nascono dalle righe aggiornate, non da quelle di ieri', () => {
    expect(CARRELLO).toContain('cartTotal(righe)');
    expect(CARRELLO).toContain('for (const it of righe)');
  });

  it('e se il prezzo è cambiato si dice lì, non alla cassa', () => {
    expect(CARRELLO).toContain('cambiatoDaQuandoLoHaiMesso');
    expect(CARRELLO).toContain('Il prezzo è cambiato');
  });

  it("l'email di recupero carrello non promette più un totale vecchio", () => {
    const email = leggi('app/api/cron/abandoned-carts/route.ts');
    expect(
      email,
      'scriveva «Il tuo carrello (€X) ti aspetta» con la cifra fotografata quando è stato abbandonato',
    ).not.toMatch(/carrello \(€\$\{Number\(c\.cart_total\)/);
  });
});

describe('④ due varianti dello stesso prodotto sono due righe diverse', () => {
  it('il riepilogo della cassa stampa la variante, come fa il carrello', () => {
    expect(RIEPILOGO, 'la variante scelta non compariva: due righe indistinguibili').toContain(
      'item.variantLabel',
    );
    expect(CARRELLO).toContain('item.variantLabel');
  });

  it('e la chiave di riga è prodotto + variante, non il solo prodotto', () => {
    expect(RIEPILOGO).toContain("key={`${item.id}::${item.variantId ?? ''}`}");
  });
});

describe('⑤ la barra dei passi: una numerazione sola, e non va a capo', () => {
  it('la barra non ha più numeri suoi: quelli restano alle schede della cassa', () => {
    expect(
      BARRA_PASSI,
      'i numeri della barra si scontravano con quelli delle schede: due «3» che volevano dire cose diverse',
    ).not.toMatch(/\{done \? <Check[^}]*\/> : num\}/);
    expect(BARRA_PASSI).not.toContain('num: number;\n  label: string;\n  active');
    expect(CASSA, 'le schede numerate della cassa restano l\'unica numerazione').toContain('<StepCard n={1}');
  });

  it('sotto i 640 pixel si legge una riga sola, e niente può andare a capo', () => {
    // Si guardano solo le classi vere: la parola compare anche nel commento che racconta il difetto.
    const classi = [...BARRA_PASSI.matchAll(/className="([^"]*)"/g)].map((m) => m[1]).join(' ');
    expect(classi, 'con `flex-wrap` il terzo passo scendeva sotto gli altri due').not.toContain('flex-wrap');
    expect(BARRA_PASSI).toContain('Passo {currentStep} di {quanti}');
    expect(BARRA_PASSI).toContain('hidden sm:flex');
  });

  it('il terzo passo si accende quando l\'ordine parte', () => {
    expect(
      CASSA,
      '`currentStep` era fisso a 2: «Conferma» restava grigio per sempre e la barra prometteva un passo in più dopo il pagamento',
    ).toContain('currentStep={inPartenza ? 3 : 2}');
  });
});

describe('⑥ i segnaposto delle foto non escono dal nostro dominio', () => {
  const suPercorsoDAcquisto = [
    'components/ProductCard.tsx',
    'app/cart/page.tsx',
    'components/checkout/CartGroupsList.tsx',
    'app/product/[id]/page.tsx',
  ];

  it('nessuna richiesta a placehold.co dalle pagine con cui si compra', () => {
    for (const f of suPercorsoDAcquisto) {
      expect(
        leggi(f),
        `${f} chiede ancora il segnaposto a placehold.co: dominio esterno, non preconnesso, e se è giù la foto resta un buco`,
      ).not.toContain('placehold.co');
    }
  });

  it('il segnaposto è un file nostro, che il service worker tiene già in cache', () => {
    const costante = leggi('lib/foto-mancante.ts');
    const percorso = costante.match(/FOTO_MANCANTE = '([^']+)'/)?.[1];
    expect(percorso, 'la costante del segnaposto non si legge più').toBeTruthy();
    expect(percorso!.startsWith('/'), 'il segnaposto deve essere servito dal nostro dominio').toBe(true);
    expect(() => leggi(`public${percorso}`), `manca il file public${percorso}`).not.toThrow();
    // Regola 3 di public/sw.js: i nostri .svg vanno in cache-first.
    expect(percorso!.endsWith('.svg')).toBe(true);
    expect(leggi('public/sw.js')).toMatch(/svg\|png\|woff2\?\|ico/);
  });
});

describe('⑦ i bersagli da toccare sul percorso d\'acquisto', () => {
  const MINIMO_TAILWIND = 11; // w-11 = 2.75rem = 44px

  it('i tasti «+» e «−» hanno la stessa misura nel carrello e nella barra d\'acquisto', () => {
    const barra = leggi('components/StickyAddToCart.tsx');
    const nellaBarra = [...barra.matchAll(/className="w-(\d+) h-(\d+) inline-flex items-center justify-center text-ink-700/g)];
    const nelCarrello = [...CARRELLO.matchAll(/className="w-(\d+) h-(\d+) hover:bg-cream-100 rounded-[lr]-full/g)];
    expect(nellaBarra.length, 'i tasti della barra non si leggono più').toBe(2);
    expect(nelCarrello.length, 'i tasti del carrello non si leggono più').toBe(2);
    for (const m of [...nellaBarra, ...nelCarrello]) {
      expect(Number(m[1]), `un tasto della quantità è w-${m[1]}: sotto i 44 pixel del dito`).toBeGreaterThanOrEqual(MINIMO_TAILWIND);
      expect(Number(m[2])).toBeGreaterThanOrEqual(MINIMO_TAILWIND);
    }
  });
});

describe('⑧ la colonna del menu account non si infila sotto l\'intestazione', () => {
  it('l\'offset lo legge dal token, non da un 96 scritto a mano', () => {
    const shell = leggi('components/account/AccountShell.tsx');
    expect(shell, '`lg:top-24` sono 96 pixel, l\'intestazione ne occupa 144').not.toContain('lg:top-24');
    expect(shell).toContain('lg:top-[var(--header-height)]');
    expect(leggi('app/globals.css'), 'il token dell\'altezza intestazione non esiste più').toContain('--header-height');
  });
});
