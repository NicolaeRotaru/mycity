/**
 * IL BIANCO SUL VERDE CHIARO NON SI LEGGEVA — e ci era già tornato una volta.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────
 * `olive-500` (#7C8B5A) col bianco sopra stacca 3,69 volte. Per un testo lo
 * standard ne chiede 4,5 (WCAG 2.1 — 1.4.3, livello AA). In dieci punti del
 * sito era quello il fondo delle pastiglie bianche: «Aperto ora» sulla
 * copertina del negozio, lo sconto per il ritiro in cassa, la spunta dei passi
 * del pagamento, il ruolo nella barra in alto, «Negozio attivo» sul cruscotto
 * del venditore. Nella riga accanto, lo stesso sito usava `olive-600`
 * (#5A7C42), che di volte ne stacca 4,78 e passa: due verdi affiancati, uno
 * buono e uno no.
 *
 * ── Perché questa prova esiste ──────────────────────────────────────────────
 * Perché i dieci punti erano GIÀ stati corretti, e il difetto è rientrato lo
 * stesso. Il 6/9 due sfumature — `from-olive-500 … text-white`, sul codice di
 * consegna dell'ordine e sulla fascia del credito di benvenuto — hanno rimesso
 * in pagina lo stesso 3,69, perché nessuno guardava le fermate di una
 * sfumatura, e perché la formula del contrasto viveva solo dentro i file di
 * prova: non esisteva un modo di CHIEDERE a una funzione se un accostamento si
 * legge.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Il conto vero, non la parola. I colori si leggono dalla tavolozza dichiarata
 * in `app/globals.css`, le classi si leggono dai componenti veri, e il rapporto
 * di contrasto lo CALCOLA `lib/design/contrasto.ts` con la formula dello
 * standard. Cercare «bg-olive-500» in un file non proverebbe niente: il difetto
 * non è quel nome, è quel numero.
 *
 * Vale su tutto `app/` e `components/`, sfumature comprese. Se domani qualcuno
 * schiarisce un tono nella tavolozza, o rimette del bianco su un verde chiaro
 * in una pagina qualsiasi, questa prova diventa rossa da sola.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BIANCO,
  SOGLIA_TESTO,
  accostamentiBianchiDeboli,
  contrasto,
  quantiAccostamentiBianchi,
  tavolozzaDaCss,
} from '@/lib/design/contrasto';

const RADICE = process.cwd();

/** La tavolozza vera del sito, non una copia scritta a mano qui dentro. */
const TAVOLOZZA = tavolozzaDaCss(readFileSync(join(RADICE, 'app/globals.css'), 'utf8'));

function tsxSotto(cartella: string, raccolti: string[] = []): string[] {
  for (const voce of readdirSync(join(RADICE, cartella))) {
    if (voce === 'node_modules' || voce === '.next') continue;
    const relativo = `${cartella}/${voce}`;
    if (statSync(join(RADICE, relativo)).isDirectory()) tsxSotto(relativo, raccolti);
    else if (relativo.endsWith('.tsx')) raccolti.push(relativo);
  }
  return raccolti;
}

const TUTTI_I_TSX = [...tsxSotto('app'), ...tsxSotto('components')];

type Trovato = { file: string; sfondo: string; colore: string; misura: number };

const DEBOLI: Trovato[] = TUTTI_I_TSX.flatMap((file) =>
  accostamentiBianchiDeboli(readFileSync(join(RADICE, file), 'utf8'), TAVOLOZZA).map((d) => ({
    file,
    sfondo: d.sfondo,
    colore: d.colore,
    misura: d.misura,
  })),
);

const targa = (t: Trovato) => `${t.file} :: ${t.sfondo}`;

/**
 * IL DEBITO DICHIARATO — otto accostamenti deboli che questo lotto NON ripara.
 *
 * Non sono verdi: sono l'arancio del sito (`primary-500`, 3,79) usato come
 * prima fermata dei cerchietti con l'iniziale dentro, e una pastiglia
 * `accent-600` (3,25) in una pagina di amministrazione. Sono cerchi che
 * contengono un'icona o una lettera, non una riga da leggere, e per le parti
 * grafiche la soglia dello standard è 3, non 4,5: valutarli uno per uno è un
 * lavoro suo, con chi disegna, e allargarlo qui avrebbe voluto dire toccare
 * otto file di altri per un difetto che parlava di verde.
 *
 * La regola che li tiene fermi: **questa lista può solo accorciarsi**. Un
 * accostamento debole nuovo, in qualunque pagina, non è qui dentro e fa
 * diventare rossa la prova. Chi ne ripara uno non deve toccare niente.
 */
const DEBITO_DICHIARATO = new Set([
  'app/admin/funnel/page.tsx :: accent-600',
  'app/cart/page.tsx :: primary-500',
  'app/profile/page.tsx :: primary-500',
  'app/rider/page.tsx :: primary-500',
  'app/seller/orders/[id]/page.tsx :: primary-500',
  'components/account/AccountSidebar.tsx :: primary-500',
  'components/seller/CatalogCopilot.tsx :: primary-500',
  'components/seller/SellerShell.tsx :: primary-500',
]);

/** I dieci punti della scheda, più le due sfumature da cui il difetto è rientrato. */
const PUNTI_DELLA_SCHEDA = [
  'components/store-sections/HeroSection.tsx',
  'components/checkout/PaymentMethodSelector.tsx',
  'components/checkout/StepIndicator.tsx',
  'app/stores/page.tsx',
  'app/profile/referral/page.tsx',
  'components/OrderTimeline.tsx',
  'components/Navbar.tsx',
  'components/MobileAccountSheet.tsx',
  'app/seller/dashboard/page.tsx',
  'app/orders/[id]/page.tsx',
  'components/WelcomeCreditBanner.tsx',
];

describe('il conto del contrasto è quello dello standard, non un numero inventato', () => {
  it('bianco su nero fa 21, il massimo possibile', () => {
    expect(contrasto(BIANCO, '#000000')).toBeCloseTo(21, 5);
  });

  it('riconosce il verde di prima come insufficiente e quello di adesso come buono', () => {
    // Sono i due numeri della scheda. Senza questa riga, un calcolo rotto che
    // tornasse sempre un valore alto farebbe passare tutto il resto del file.
    expect(contrasto('#7C8B5A', BIANCO)).toBeCloseTo(3.69, 1);
    expect(contrasto('#5A7C42', BIANCO)).toBeCloseTo(4.78, 1);
    expect(contrasto('#7C8B5A', BIANCO)).toBeLessThan(SOGLIA_TESTO);
    expect(contrasto('#5A7C42', BIANCO)).toBeGreaterThanOrEqual(SOGLIA_TESTO);
  });

  it('la tavolozza è quella vera del sito, letta da globals.css', () => {
    expect(Object.keys(TAVOLOZZA).length, 'non ho letto nessun colore da app/globals.css').toBeGreaterThan(20);
    expect(TAVOLOZZA['olive-500'], 'olive-500 non è più dichiarato: questa prova va riscritta').toBe('#7C8B5A');
    expect(TAVOLOZZA['olive-600'], 'olive-600 non è più dichiarato: questa prova va riscritta').toBe('#5A7C42');
  });
});

describe('la scansione guarda davvero il sito', () => {
  it('trova centinaia di scritte bianche su un fondo colorato', () => {
    // Se la scansione smettesse di trovare niente — un cambio di regex, una
    // cartella spostata — le prove qui sotto passerebbero senza guardare
    // nulla. Oggi ne conta 363: la soglia è larga apposta.
    const quanti = TUTTI_I_TSX.reduce(
      (somma, f) => somma + quantiAccostamentiBianchi(readFileSync(join(RADICE, f), 'utf8'), TAVOLOZZA),
      0,
    );
    expect(quanti, 'la scansione non trova più scritte bianche: la difesa è diventata muta').toBeGreaterThan(200);
  });

  it('apre tutti i punti nominati dalla scheda', () => {
    for (const punto of PUNTI_DELLA_SCHEDA) {
      expect(TUTTI_I_TSX, `${punto} non è più fra i file scansionati`).toContain(punto);
    }
  });
});

describe('nessuna scritta bianca sta su un verde troppo chiaro', () => {
  it('in nessuno dei dodici punti della scheda', () => {
    const nei = DEBOLI.filter((d) => PUNTI_DELLA_SCHEDA.includes(d.file));
    expect(
      nei.map((d) => `${d.file}: bianco su ${d.sfondo} (${d.colore}) = ${d.misura.toFixed(2)}`),
      `Sono i punti che la radiografia ha nominato: servono almeno ${SOGLIA_TESTO} volte di stacco.`,
    ).toEqual([]);
  });

  it('e in nessun altro punto di app/ e components/, sfumature comprese', () => {
    const verdi = DEBOLI.filter((d) => d.sfondo.startsWith('olive-'));
    expect(
      verdi.map((d) => `${d.file}: bianco su ${d.sfondo} (${d.colore}) = ${d.misura.toFixed(2)}`),
      'Il verde del sito che regge il bianco è olive-600 (4,78). olive-500 (3,69) no: ' +
        'è la differenza fra una pastiglia che si legge e una che si indovina.',
    ).toEqual([]);
  });
});

describe('e il debito che resta può solo accorciarsi', () => {
  it('nessun accostamento debole nuovo, in nessuna pagina', () => {
    const nuovi = DEBOLI.filter((d) => !DEBITO_DICHIARATO.has(targa(d)));
    expect(
      nuovi.map((d) => `${d.file}: bianco su ${d.sfondo} (${d.colore}) = ${d.misura.toFixed(2)}`),
      `Serve almeno ${SOGLIA_TESTO} fra un testo e il suo sfondo (WCAG 2.1 — 1.4.3, livello AA). ` +
        'Il tono subito più scuro della stessa famiglia di solito basta. Se questo accostamento ' +
        'è un elemento grafico e non un testo, scrivilo nel debito dichiarato con il perché.',
    ).toEqual([]);
  });

  it('il debito dichiarato non contiene nessun verde', () => {
    // Il difetto della scheda parlava di verde: se un verde ricomparisse qui
    // dentro, vorrebbe dire che qualcuno l'ha riaperto passando dalla porta di
    // servizio invece che dalla finestra.
    expect([...DEBITO_DICHIARATO].filter((t) => t.includes(':: olive-'))).toEqual([]);
  });

  it('conta al massimo quanti ne aveva dichiarati: otto', () => {
    expect(DEBOLI.length, 'ripararne uno va benissimo; aggiungerne uno no').toBeLessThanOrEqual(
      DEBITO_DICHIARATO.size,
    );
  });
});
