/**
 * @vitest-environment jsdom
 */
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
 * 30/10/2026 — Il punto ② non cerca più `shippingForEuro` nel carrello: dal 29/10 il carrello conta
 * con `prezziDelCarrello`, come la cassa. Adesso il carrello si MONTA, e la consegna e il totale che
 * scrive si confrontano con quelli della cassa (`riepilogoDaMostrare`) sugli stessi ingressi, sugli
 * esempi firmati da Nicola. Diventa rossa se il carrello torna a fare un conto suo.
 *
 * 30/10/2026 (ondata 17) — Gli esempi avevano tutti un pezzo per riga, e la prova leggeva solo la
 * riga nascosta per i lettori di schermo: un conto della consegna che ignora la quantità, un totale
 * a video senza la consegna, o una riga «Consegna MyCity» a 0 € mentre la cassa addebita 3 €,
 * restavano verdi. Adesso ci sono anche più pezzi per riga (3 pagnotte da 2,50 €: 7,50 € di spesa,
 * consegna 4 €), e si leggono le cifre che si VEDONO: la consegna, il subtotale e il totale, nel
 * riepilogo e nella barra in fondo, confrontate con la cassa sugli stessi ingressi.
 *
 * Il resto della prova legge il sorgente delle due pagine: sono difetti di gravità minore, e il manuale del
 * lotto ammette la verifica sul sorgente. Diventa rossa se qualcuno rimette la divergenza.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { formatPrice } from '@/lib/format';
import { riepilogoDaMostrare } from '@/lib/ordini/riepilogo-cassa';
import { VOCE_CONSEGNA, rigaDellaVeloceNelCarrello } from '@/lib/promesse-pubbliche';
import { accendi } from './aiuti/schermo';

vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('@/components/cart/CartUpsell', () => ({ CartUpsell: () => null }));
vi.mock('@/components/ShareCartButton', () => ({ default: () => null }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<typeof import('@/lib/promotions')>()),
  fetchActiveDiscounts: async () => new Map(),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchSellerPublicMap: async () => new Map() }));

const reteDiPartenza = globalThis.fetch;
// L'import pigro del database, dentro la pagina, sfugge al vi.mock qui sopra: nasce il client vero,
// su un indirizzo finto, e ogni sua lettura riceve un 503 (la pagina si disegna lo stesso, come
// quando la rete cade davvero). Le variabili, impostate prima di ogni prova, restano tali.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'chiave-finta';
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
  return { ok: true, json: async () => ({ possibile: true }) };
}) as unknown as typeof fetch;

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
});
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});

/** Una riga del carrello: il prezzo di un pezzo e quanti pezzi. */
type Riga = { prezzo: number; pezzi: number };

/** Il carrello montato alle 14 (la veloce c'è): per ogni negozio, le sue righe. */
async function carrelloCon(negozi: Riga[][]) {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 30, 14, 0));
  localStorage.setItem(
    'cart',
    JSON.stringify(
      negozi.flatMap((righe, n) =>
        righe.map((r, i) => ({
          id: `p-${n}-${i}`,
          name: `Prodotto ${n}-${i}`,
          price: r.prezzo,
          quantity: r.pezzi,
          sellerId: `neg-${n}`,
          storeName: `Negozio ${n}`,
        })),
      ),
    ),
  );
  schermo = accendi(CartPage);
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  const s = schermo;
  return {
    stato: () => s.radice.querySelector('[role="status"]')?.textContent ?? '',
    pagina: () => s.radice.textContent ?? '',
    /**
     * Le cifre che si VEDONO accanto a un'etichetta («Totale», «Consegna MyCity», «Subtotale»): per
     * ogni elemento che dice solo l'etichetta, la prima cifra dell'elemento che lo segue. È quello che
     * legge chi guarda lo schermo, non la riga nascosta per i lettori di schermo.
     */
    cifreAccantoA: (etichetta: string) =>
      [...s.radice.querySelectorAll('span, div')]
        .filter((el) => (el.textContent ?? '').trim() === etichetta)
        .map((el) => {
          const accanto = el.nextElementSibling;
          return ((accanto?.firstElementChild ?? accanto)?.textContent ?? '').trim();
        }),
  };
}


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

describe('② la consegna: il carrello fa il conto della cassa, sugli stessi ingressi', () => {
  /** La chiamata a `prezziDelCarrello` dentro il carrello, presa per intero. */
  const inizio = CARRELLO.indexOf('= prezziDelCarrello({');
  const chiamata = CARRELLO.slice(inizio, CARRELLO.indexOf('consegnaVeloce:', inizio));

  it('il carrello conta con la funzione della cassa: senza, questa prova non misura niente', () => {
    expect(inizio, 'il carrello non chiama più `prezziDelCarrello`').toBeGreaterThan(0);
    expect(chiamata.length).toBeGreaterThan(20);
    expect(CASSA).toContain('riepilogoDaMostrare({');
  });

  it('le coordinate arrivano da dove sta il negozio e da dove consegniamo, non a `null` scritte a mano', () => {
    // Al lancio la spedizione a distanza vale zero: il giorno che torna, un carrello senza
    // coordinate ripiegherebbe su una tariffa fissa mentre la cassa calcola sulla distanza.
    expect(chiamata).toContain('dovEIlNegozio[key]');
    expect(chiamata).toContain('consegnaLat: doveConsegniamo.lat');
    expect(chiamata).toContain('consegnaLng: doveConsegniamo.lng');
    expect(chiamata).not.toMatch(/consegnaL(at|ng):\s*null/);
    expect(CARRELLO).toContain("from('user_addresses')");
    expect(CARRELLO).toContain('store_lat, store_lng');
    expect(CASSA).toContain("from('user_addresses')");
  });

  /** Una riga sola, un pezzo solo, per ogni negozio: gli esempi detti in euro di spesa. */
  const unPezzo = (...euro: number[]): Riga[][] => euro.map((e) => [{ prezzo: e, pezzi: 1 }]);

  /**
   * Gli esempi firmati da Nicola il 29/10 alle 22:21 (spesa per negozio → consegna con la fascia /
   * con la veloce), e gli stessi conti con più pezzi per riga: la spesa di un negozio è prezzo ×
   * pezzi. Se il carrello contasse un pezzo solo, 2 × 5 € farebbero 5 € e la consegna salirebbe a 4 €.
   */
  const ESEMPI: Array<{ negozi: Riga[][]; fascia: number; veloce: number }> = [
    { negozi: unPezzo(15), fascia: 300, veloce: 400 },
    { negozi: unPezzo(8), fascia: 400, veloce: 400 },
    { negozi: unPezzo(15, 12), fascia: 400, veloce: 500 },
    { negozi: unPezzo(15, 6), fascia: 500, veloce: 500 },
    { negozi: unPezzo(6, 7), fascia: 600, veloce: 600 },
    { negozi: unPezzo(15, 12, 20), fascia: 500, veloce: 600 },
    { negozi: unPezzo(5, 6, 7), fascia: 800, veloce: 800 },
    // Tre pagnotte da 2,50 €: 7,50 € di spesa, sotto i 10 €, consegna 4 €.
    { negozi: [[{ prezzo: 2.5, pezzi: 3 }]], fascia: 400, veloce: 400 },
    // Due pezzi da 5 € dallo stesso negozio: 10 €, non sotto i 10, consegna 3 € come la cassa.
    { negozi: [[{ prezzo: 5, pezzi: 2 }]], fascia: 300, veloce: 400 },
    { negozi: [[{ prezzo: 4, pezzi: 4 }]], fascia: 300, veloce: 400 },
    // Due righe nello stesso negozio: 2 × 3 € + 3 × 1,50 € = 10,50 €.
    { negozi: [[{ prezzo: 3, pezzi: 2 }, { prezzo: 1.5, pezzi: 3 }]], fascia: 300, veloce: 400 },
    // Due negozi: 3 pagnotte da 2,50 € (7,50 €, spesa piccola) e 2 × 6 € (12 €): 3 + 1 + 1.
    { negozi: [[{ prezzo: 2.5, pezzi: 3 }], [{ prezzo: 6, pezzi: 2 }]], fascia: 500, veloce: 500 },
  ];

  /** «15 + 12», «3 × 2.5», «(2 × 3 e 3 × 1.5)»: la spesa di ogni negozio, per il nome della prova. */
  const descrivi = (negozi: Riga[][]) =>
    negozi
      .map((righe) => {
        const parti = righe.map((r) => (r.pezzi === 1 ? `${r.prezzo}` : `${r.pezzi} × ${r.prezzo}`));
        return parti.length === 1 ? parti[0] : `(${parti.join(' e ')})`;
      })
      .join(' + ');

  /**
   * La cassa, con gli stessi ingressi che il carrello ha in mano: stessi negozi, stessa merce
   * (prezzo × pezzi, riga per riga), nessuna coordinata letta (qui il database non risponde),
   * nessun codice, nessun credito. Prima di confrontare, la cassa stessa deve seguire la regola firmata.
   */
  function laCassa(e: { negozi: Riga[][]; fascia: number; veloce: number }) {
    const conto = (veloce: boolean) =>
      riepilogoDaMostrare({
        gruppi: e.negozi.map((righe, n) => ({
          sellerId: `neg-${n}`,
          subtotalCents: righe.reduce((somma, r) => somma + Math.round(r.prezzo * 100) * r.pezzi, 0),
        })),
        coordinateNegozio: () => ({ lat: null, lng: null }),
        consegnaLat: null,
        consegnaLng: null,
        pickupInStore: false,
        couponSpedizioneGratis: false,
        couponScontoCents: 0,
        consegnaVeloce: veloce,
        usaCredito: false,
        creditoDisponibileCents: 0,
      });
    const conFascia = conto(false);
    const conVeloce = conto(true);
    const consegnaCents = Math.round((conFascia.totale - conFascia.subtotale) * 100);
    expect(consegnaCents, 'la cassa non segue più la regola firmata').toBe(e.fascia);
    expect(Math.round((conVeloce.totale - conVeloce.subtotale) * 100)).toBe(e.veloce);
    return { conFascia, conVeloce, consegnaCents };
  }

  for (const e of ESEMPI) {
    const spesa = `spesa ${descrivi(e.negozi)} €`;

    it(`${spesa}: il carrello montato scrive la consegna e il totale della cassa`, async () => {
      const { conFascia, conVeloce, consegnaCents } = laCassa(e);
      const c = await carrelloCon(e.negozi);
      expect(c.stato(), 'il carrello scrive una consegna o un totale diversi da quelli della cassa').toContain(
        `consegna ${formatPrice(consegnaCents / 100)}, totale ${formatPrice(conFascia.totale)}`,
      );
      expect(c.pagina(), 'la veloce del carrello costa diversa da quella della cassa').toContain(
        rigaDellaVeloceNelCarrello(true, Math.round((conVeloce.totale - conFascia.totale) * 100), consegnaCents)!,
      );
    });

    it(`${spesa}: a video la riga «${VOCE_CONSEGNA}» e il subtotale sono quelli della cassa`, async () => {
      const { conFascia, consegnaCents } = laCassa(e);
      const c = await carrelloCon(e.negozi);
      const consegne = c.cifreAccantoA(VOCE_CONSEGNA);
      expect(consegne.length, `la riga «${VOCE_CONSEGNA}» non si legge più a video`).toBeGreaterThan(0);
      expect(consegne, 'a video la consegna è diversa da quella che la cassa addebita').toEqual(
        consegne.map(() => formatPrice(consegnaCents / 100)),
      );
      const subtotali = c.cifreAccantoA('Subtotale');
      expect(subtotali.length, 'il subtotale non si legge più a video').toBeGreaterThan(0);
      expect(subtotali, 'a video la merce costa diversa da quella della cassa').toEqual(
        subtotali.map(() => formatPrice(conFascia.subtotale)),
      );
    });

    it(`${spesa}: a video il totale, nel riepilogo e nella barra in fondo, è quello della cassa`, async () => {
      const { conFascia } = laCassa(e);
      const c = await carrelloCon(e.negozi);
      const totali = c.cifreAccantoA('Totale');
      expect(totali.length, 'il totale a video si legge nel riepilogo e nella barra in fondo').toBeGreaterThanOrEqual(2);
      expect(totali, 'a video il totale è diverso da quello che la cassa addebita').toEqual(
        totali.map(() => formatPrice(conFascia.totale)),
      );
    });
  }
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
