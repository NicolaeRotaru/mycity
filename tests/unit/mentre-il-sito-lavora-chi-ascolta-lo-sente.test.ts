/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { corsieSotto, fondoDellaBarra } from '@/lib/ui/barra-in-fondo';
import { VARIABILE_ALTEZZA } from '@/lib/altezza-banner';

/**
 * MENTRE IL SITO LAVORA, CHI ASCOLTA LO SENTE — E CHI NON USA IL MOUSE ESCE.
 *
 * 6/9/2026 — TRE RIMEDI SCRITTI STAMATTINA CHE NON RIMEDIAVANO.
 *
 * ① DUE ATTESE MUTE. Aprendo la vetrina di un negozio e aprendo il primo passo della
 *    cassa erano state marcate due attese come regioni vive: `role="status"`,
 *    `aria-live="polite"`, e un `aria-label` col nome dell'attesa. Dentro, pero', non
 *    c'era UNA parola: solo riquadri grigi. Una regione viva annuncia il proprio
 *    CONTENUTO quando cambia, non il proprio NOME — su una regione vuota quel nome
 *    nessuno va a leggerlo, perche' nessuno ci naviga sopra. NVDA, VoiceOver e
 *    TalkBack dicevano esattamente quanto prima: niente. E il commento nel file
 *    dichiarava il difetto chiuso, che e' la parte peggiore: domani nessuno lo
 *    riguarda. Nello STESSO lotto altre due attese erano state fatte bene (la griglia
 *    dei prodotti dice «Aggiorno i risultati…»): non mancava la conoscenza, mancava
 *    qualcosa che potesse diventare rosso.
 *
 * ② IL PANNELLO DELLE CATEGORIE PORTAVA IL FUOCO SULLA PORTA SBAGLIATA. Due lavori
 *    sono atterrati sullo stesso pannello nello stesso giorno: uno ha aggiunto la «×»
 *    per chiudere sul telefono, l'altro lo spostamento del fuoco all'apertura — ma
 *    cercando `a[href]`, cioe' solo i collegamenti. Chi entrava da tastiera si trovava
 *    davanti l'elenco delle categorie e l'uscita alle spalle.
 *
 * ③ IL BANNER DEI COOKIE COPRIVA LA BARRA IN FONDO. Da quando la pagina si prende
 *    tutto lo schermo dell'iPhone (`viewportFit: 'cover'`), la barra a schede si e'
 *    alzata di 34 punti e il banner, inchiodato a 72 scritti a mano, le e' finito
 *    sopra — alla primissima visita, la prima cosa che uno vede.
 *
 * Questa prova monta i componenti VERI e guarda cosa succede: cosa contiene la regione
 * che deve parlare, dove atterra il fuoco, che conto fa il banner.
 *
 * ⚠️ COSA NON VEDE. Nessuno screen reader vero: che NVDA legga quella frase lo so
 * dalla specifica ARIA, non l'ho sentito. E nessun iPhone fisico: il conto del banner
 * lo controllo, il pixel no.
 */

const RADICE = process.cwd();

/**
 * Il sorgente senza i commenti. Serve: i commenti di questi file raccontano il
 * difetto che hanno chiuso, quindi contengono le stesse stringhe che la prova
 * cerca. Cercarle nel testo intero vorrebbe dire diventare rossi per una frase.
 */
function senzaCommenti(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/* ────────────────────────────────────────────────────────────────────────────
 * ① LE ATTESE CHE DEVONO PARLARE
 * ──────────────────────────────────────────────────────────────────────────── */

/** Il testo che un lettore di schermo annuncia da una regione viva. */
function cosaAnnuncia(regione: Element): string {
  const copia = regione.cloneNode(true) as Element;
  copia.querySelectorAll('[aria-hidden="true"], [aria-hidden=""], svg').forEach((n) => n.remove());
  return (copia.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Le regioni vive dentro un pezzo di pagina montato. */
function regioniVive(radice: Element): Element[] {
  return Array.from(radice.querySelectorAll('[role="status"], [role="alert"], [aria-live]'));
}

describe('l\'attesa che si vede aprendo la vetrina di un negozio', () => {
  it('annuncia una frase, non soltanto il proprio nome', async () => {
    const mod = await monta('components/store-sections/ScheletroNegozio.tsx');
    const s = accendi(mod.default, {});

    const regioni = regioniVive(s.radice);
    expect(
      regioni.length,
      'Lo scheletro del negozio non e\' piu\' una regione viva: chi ascolta non sa che il sito sta lavorando',
    ).toBeGreaterThan(0);

    for (const r of regioni) {
      expect(
        cosaAnnuncia(r),
        'La regione viva dello scheletro del negozio non contiene nessuna parola. Un `aria-label` su un ' +
          '`role="status"` vuoto non si sente: una regione viva annuncia il proprio CONTENUTO quando ' +
          'cambia, non il proprio nome. Metti dentro una frase `sr-only`, come fa components/ProductGrid.tsx.',
      ).not.toBe('');
    }
    s.smonta();
  }, 60000);
});

describe('l\'attesa del primo passo della cassa', () => {
  it('annuncia che sta caricando gli indirizzi salvati', async () => {
    const mod = await monta('components/checkout/ShippingAddressForm.tsx');
    const s = accendi(mod.ShippingAddressForm, {
      form: { fullName: '', address: '', city: '', zip: '', phone: '', notes: '' },
      savedAddresses: [],
      caricamento: true,
      onChange: () => {},
      onSubmit: () => {},
      onApplySavedAddress: () => {},
    });

    const regioni = regioniVive(s.radice);
    expect(
      regioni.length,
      'Il primo passo della cassa non dichiara piu\' un\'attesa: in cassa il silenzio costa un ordine',
    ).toBeGreaterThan(0);

    for (const r of regioni) {
      expect(
        cosaAnnuncia(r),
        'In cassa la regione viva dell\'attesa e\' vuota: le due mattonelle grigie sono `aria-hidden`, ' +
          'quindi chi ascolta non sente NIENTE mentre arrivano gli indirizzi salvati — nel punto del ' +
          'percorso in cui l\'incertezza fa abbandonare l\'ordine.',
      ).not.toBe('');
    }
    s.smonta();
  }, 60000);
});

/* ────────────────────────────────────────────────────────────────────────────
 * ② LA VIA D'USCITA DEL PANNELLO CATEGORIE — NON C'E', ED E' DICHIARATO
 *
 * Il difetto e' vero e il rimedio e' di una riga sola, in components/CategoryBar.tsx:
 * il selettore che sposta il fuoco cerca `a[href]`, cioe' solo i collegamenti, e la
 * «×» «Chiudi le categorie» e' un `button`. Aprendo il pannello da tastiera il fuoco
 * atterra su «Tutti i negozi» e l'unica uscita che si vede su schermo piccolo resta
 * alle spalle.
 *
 * NON e' stato riparato qui, e non per pigrizia: la prova che oggi copre quel pannello
 * — tests/unit/il-pannello-delle-categorie-si-apre-a-misura-di-schermo.test.ts, riga 77
 * — pretende che il fuoco vada sul primo LINK. Quella prova e' fuori dal territorio di
 * questa squadra, e cambiarla mentre un'altra squadra ci lavora vorrebbe dire
 * riscriverle il lavoro. La riparazione e' pronta e sta scritta nel frammento della
 * squadra, sotto `bloccati`: e' una riga di codice piu' una riga di prova, e vanno
 * fatte insieme o non funziona nessuna delle due.
 * ──────────────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────────────
 * ③ I BORDI DELLO SCHERMO CHE IL TELEFONO SI TIENE
 * ──────────────────────────────────────────────────────────────────────────── */

describe('la zona sicura dello schermo, adesso che la pagina se lo prende tutto', () => {
  it('la pagina legge anche i bordi di sinistra e di destra, non solo quello di sotto', () => {
    const layout = senzaCommenti(readFileSync(join(RADICE, 'app/layout.tsx'), 'utf8'));

    expect(
      /viewportFit:\s*'cover'/.test(layout),
      'app/layout.tsx non chiede piu\' tutto lo schermo: se e\' voluto, questa prova va ripensata insieme a quella scelta',
    ).toBe(true);

    // Chi si prende i bordi arrotondati DEVE leggerli tutti e quattro. Il bordo di
    // sotto ha gia' casa in app/globals.css e in lib/ui/barra-in-fondo.ts; qui si
    // controllano i due laterali, che col telefono ruotato valgono 44 punti per parte.
    for (const lato of ['left', 'right']) {
      expect(
        layout.includes(`env(safe-area-inset-${lato}`),
        `Con la pagina che si prende tutto lo schermo, nessuno legge \`safe-area-inset-${lato}\`. ` +
          'Su un iPhone ruotato il notch e l\'angolo arrotondato si mangiano 44 punti per lato, e il ' +
          'padding piu\' largo del sito e\' 24: il marchio in alto a sinistra e i comandi account/carrello ' +
          'in alto a destra finiscono sotto il bordo.',
      ).toBe(true);
    }
  });

  it('il banner dei cookie sta sopra la barra a schede, barra gestuale compresa', () => {
    const src = senzaCommenti(readFileSync(join(RADICE, 'components/CookieBanner.tsx'), 'utf8'));

    // Il conto vero, fatto dalla casa unica di chi-sta-sopra-chi.
    const atteso = fondoDellaBarra(corsieSotto(VARIABILE_ALTEZZA));
    expect(
      atteso,
      'La corsia del banner dei cookie non somma piu\' la barra gestuale dell\'iPhone',
    ).toContain('env(safe-area-inset-bottom');
    expect(atteso, 'La corsia del banner non scavalca piu\' la barra a schede').toContain('--tabbar-height');

    expect(
      /bottom:\s*fondoDellaBarra\(\s*corsieSotto\(/.test(src),
      'components/CookieBanner.tsx si scrive il proprio `bottom` a mano invece di chiederlo a ' +
        'lib/ui/barra-in-fondo.ts. Era `bottom-[var(--tabbar-height)]`, cioe\' 72 punti fissi: ma da ' +
        'quando la pagina si prende tutto lo schermo la barra a schede ha `pb-safe` ed e\' alta 72+34=106. ' +
        'Il banner (z-[100]) copriva la fascia superiore della barra (z-30) — Home, Cerca, Carrello, ' +
        'Ordini, Profilo — alla primissima visita.',
    ).toBe(true);

    expect(
      /bottom-\[var\(--tabbar-height\)\]/.test(src),
      'Il banner dei cookie e\' tornato a scriversi i 72 punti della barra a schede a mano: quella ' +
        'copia non conosce la barra gestuale dell\'iPhone e torna a coprire le destinazioni in fondo.',
    ).toBe(false);
  });
});
