/**
 * 3/9/2026 — SULLA SCHEDA PRODOTTO C'ERA UNA FASCIA DI SCHERMI SENZA NESSUN PULSANTE PER COMPRARE.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────
 * La griglia della scheda ha tre figli in fila: la galleria, la colonna delle informazioni e il
 * riquadro d'acquisto (prezzo, quantità, «Aggiungi al carrello»). Alla misura media — un iPad in
 * verticale, 768 pixel, o un telefono grande girato in orizzontale — la griglia diventava di DUE
 * colonne: prima riga galleria e informazioni, e il riquadro d'acquisto finiva da solo in seconda
 * riga, sotto una colonna altissima, con la cella accanto vuota. Nella stessa fascia la barra
 * d'acquisto in fondo allo schermo era già sparita (`md:hidden`), e diventava appiccicata a destra
 * solo da 1024 in su. Fra 768 e 1023 pixel non restava niente da premere senza scorrere tutto.
 *
 * E sotto, a 360 pixel, la barra in fondo non ci stava: dentro la card ci sono 312 pixel, e lo
 * stepper più il pulsante con la scritta intera ne chiedevano di più del prezzo compreso. La
 * scritta andava a capo e la cifra usciva dal proprio riquadro.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * Non cerca parole. Rifà i due conti:
 *
 *   ① LA RETE DI SICUREZZA NON HA BUCHI: la misura da cui sparisce la barra in fondo è la STESSA
 *      da cui il riquadro d'acquisto si appiccica alla destra. Le due misure si leggono dai due
 *      file veri; se qualcuno riabbassa una delle due, fra le due nasce di nuovo una fascia senza
 *      pulsanti e questa prova diventa rossa.
 *   ② IL RIQUADRO NON RESTA MAI SOLO IN UNA RIGA: se alla misura media la griglia è a due colonne
 *      e i figli sono tre, il terzo deve occupare la riga intera.
 *   ③ A 360 PIXEL IL CONTO TORNA: le larghezze si leggono dalle classi vere (stepper, imbottiture,
 *      corpo del testo) e la somma deve stare dentro la card, prezzo a tre cifre compreso.
 *
 * ⚠️ Cosa NON prova: che a schermo sia bello. La larghezza del testo è stimata da una costante
 * dichiarata qui sotto, non misurata da un browser — l'occhio su un telefono vero resta da fare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SCHEDA = readFileSync('app/product/[id]/page.tsx', 'utf8');
const BARRA = readFileSync('components/StickyAddToCart.tsx', 'utf8');

/** L'ordine delle misure di Tailwind, dalla più stretta alla più larga. */
const MISURE = ['sm', 'md', 'lg', 'xl', '2xl'];

/** Le classi del contenitore che apre un blocco, riconosciuto dal commento che gli sta sopra. */
function classiDelBloccoDopo(sorgente: string, commento: string): string {
  const i = sorgente.indexOf(commento);
  expect(i, `nel sorgente non c'è più il blocco «${commento}»: questa prova non misura niente`).toBeGreaterThan(-1);
  const dopo = sorgente.slice(i);
  const m = dopo.match(/<div className="([^"]+)"/);
  expect(m, `il blocco «${commento}» non apre più con un div: la prova va riscritta`).toBeTruthy();
  return m![1];
}

describe('① da nessuna larghezza si resta senza un pulsante per comprare', () => {
  /** Da quale misura in su la barra in fondo allo schermo sparisce. */
  const spariceLaBarra = BARRA.match(/className="(\w+):hidden fixed/)?.[1];

  /** Da quale misura in su il riquadro d'acquisto si appiccica alla colonna di destra. */
  const siAppiccica = classiDelBloccoDopo(SCHEDA, '{/* CTA STICKY').match(/(\w+):sticky/)?.[1];

  it('le due misure si leggono davvero dai file (se no non sta misurando niente)', () => {
    expect(MISURE).toContain(spariceLaBarra);
    expect(MISURE).toContain(siAppiccica);
  });

  it('la barra in fondo sparisce esattamente dove nasce la colonna appiccicata', () => {
    expect(
      spariceLaBarra,
      `la barra sparisce da «${spariceLaBarra}» ma la colonna d'acquisto arriva solo da «${siAppiccica}»: ` +
        'fra le due misure non resta nessun pulsante d\'acquisto in vista',
    ).toBe(siAppiccica);
  });
});

describe('② il riquadro d’acquisto non finisce mai da solo in una riga', () => {
  const griglia = SCHEDA.match(/className="grid grid-cols-1 ([^"]+)"/)?.[1] ?? '';
  const riquadro = classiDelBloccoDopo(SCHEDA, '{/* CTA STICKY');

  it('la griglia della scheda si legge davvero', () => {
    expect(griglia, 'la griglia della scheda prodotto è cambiata forma: la prova va riscritta').toMatch(
      /grid-cols/,
    );
  });

  it('dove le colonne sono due e i figli tre, il terzo prende la riga intera', () => {
    const colonneMedie = Number(griglia.match(/md:grid-cols-(\d+)/)?.[1] ?? 0);
    if (colonneMedie === 2) {
      expect(
        riquadro,
        'a due colonne il terzo figlio va a capo da solo, con la cella accanto vuota',
      ).toContain('md:col-span-2');
      expect(riquadro, 'e da lg deve tornare nella sua colonna, non occupare tutta la riga').toContain(
        'lg:col-span-1',
      );
    }
  });
});

describe('③ a 360 pixel la barra in fondo ci sta, prezzo a tre cifre compreso', () => {
  /**
   * Le assunzioni del conto, dichiarate. Il telefono più stretto in giro è 360px; `container` a
   * quella misura è largo quanto lo schermo. La larghezza di un carattere in grassetto è stimata
   * al 58% del corpo: è una stima, non una misura di browser.
   */
  const SCHERMO = 360;
  const PER_CARATTERE = 0.58;
  const larghezzaTesto = (testo: string, corpoPx: number) => testo.length * corpoPx * PER_CARATTERE;
  const rem = (n: number) => n * 16;
  const spaziatura = (n: number) => n * 4; // scala Tailwind: 1 = 0.25rem

  /** Quanto spazio resta dentro la card della barra, tolte le due imbottiture. */
  const dentroLaCard = (() => {
    const contenitore = BARRA.match(/container mx-auto px-(\d+)/)?.[1];
    const card = BARRA.match(/rounded-2xl shadow-warm-lg p-(\d+)/)?.[1];
    expect(contenitore, 'le imbottiture della barra non si leggono più: la prova va riscritta').toBeTruthy();
    expect(card).toBeTruthy();
    return SCHERMO - 2 * spaziatura(Number(contenitore)) - 2 * spaziatura(Number(card));
  })();

  /** Lo stepper: due pulsanti quadrati, il numero in mezzo, un bordo per lato. */
  const stepper = (() => {
    const lato = Number(BARRA.match(/className="w-(\d+) h-\d+ inline-flex items-center justify-center text-ink-700/)?.[1]);
    const numero = Number(BARRA.match(/min-w-\[([\d.]+)rem\]/)?.[1]);
    expect(lato, 'i pulsanti dello stepper non si leggono più').toBeGreaterThan(0);
    expect(numero, 'la casella del numero non si legge più').toBeGreaterThan(0);
    return 2 * spaziatura(lato) + rem(numero) + 2;
  })();

  /** Il pulsante d'acquisto come appare SOTTO i 640px: etichetta corta, icona nascosta. */
  const pulsante = (() => {
    const classi = BARRA.match(/className="ml-auto inline-flex[^"]+"/)?.[0] ?? '';
    const imbottitura = Number(classi.match(/\spx-(\d+)/)?.[1]);
    expect(imbottitura, "l'imbottitura del pulsante non si legge più").toBeGreaterThan(0);

    const corta = BARRA.match(/const ETICHETTA_CORTA = '([^']+)'/)?.[1];
    const esaurita = BARRA.match(/const ETICHETTA_ESAURITO_CORTA = '([^']+)'/)?.[1];
    expect(corta, "l'etichetta corta non esiste più: sotto i 640px torna la scritta intera").toBeTruthy();
    expect(esaurita).toBeTruthy();

    // L'icona conta solo se resta visibile anche sugli schermi stretti.
    const iconaSempreVisibile = !/<ShoppingCart[^>]*className="hidden sm:/.test(BARRA);
    const icona = iconaSempreVisibile ? 18 + spaziatura(2) : 0;

    const testoPiuLungo = Math.max(larghezzaTesto(corta!, 14), larghezzaTesto(esaurita!, 14));
    return 2 * spaziatura(imbottitura) + icona + testoPiuLungo;
  })();

  /** Il prezzo peggiore che ci si aspetta: tre cifre per due pezzi. */
  const prezzo = larghezzaTesto('€246.00', 18);

  const spazi = 2 * spaziatura(Number(BARRA.match(/p-\d+ flex items-center gap-(\d+)/)?.[1] ?? 0));

  it('il conto si fa su numeri letti dal file, non riscritti qui', () => {
    expect(dentroLaCard).toBe(312);
    expect(stepper).toBe(98);
    expect(spazi).toBeGreaterThan(0);
  });

  it('stepper + pulsante + prezzo stanno dentro la card', () => {
    const richiesto = stepper + pulsante + prezzo + spazi;
    expect(
      Math.round(richiesto),
      `servono ${Math.round(richiesto)} pixel dentro una card larga ${dentroLaCard}: ` +
        'la scritta del pulsante va a capo e la cifra esce dal suo riquadro',
    ).toBeLessThanOrEqual(dentroLaCard);
  });

  it('e quello che si stringe non è mai la scritta del pulsante', () => {
    const classi = BARRA.match(/className="ml-auto inline-flex[^"]+"/)?.[0] ?? '';
    expect(classi, 'senza questo la scritta del pulsante va a capo su due righe').toContain(
      'whitespace-nowrap',
    );
    expect(classi, 'senza questo il pulsante si comprime prima del prezzo').toContain('shrink-0');
  });

  it('il nome intero del pulsante resta per chi naviga a voce', () => {
    const intera = BARRA.match(/const ETICHETTA_INTERA = '([^']+)'/)?.[1];
    expect(intera).toBeTruthy();
    expect(BARRA, 'a schermo si legge «Aggiungi»: il nome completo deve restare nel nome accessibile')
      .toMatch(/aria-label=\{available \? ETICHETTA_INTERA/);
  });

  it('la cifra non esce dal proprio riquadro nemmeno quando lo spazio finisce', () => {
    const blocco = BARRA.slice(BARRA.indexOf('<div className="min-w-0">'), BARRA.indexOf('{hasStepper && ('));
    const totale = BARRA.match(/<p className="([^"]*)text-lg font-bold text-primary-700/)?.[1] ?? '';
    expect(blocco, 'il blocco del prezzo deve poter stringersi').toContain('min-w-0');
    expect(totale, 'senza truncate la cifra sborda dal riquadro invece di accorciarsi').toContain(
      'truncate',
    );
  });
});
