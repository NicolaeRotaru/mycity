/**
 * Il banner dei cookie cresceva e non lo diceva a nessuno.
 *
 * IL CASO, in quattro gesti. La persona apre una scheda prodotto sul telefono. In fondo allo
 * schermo c'è il banner dei cookie; sopra di lui, la barra con «Aggiungi al carrello». Per non
 * finirci sotto, la barra legge una variabile che il banner pubblica: *quanto sono alto*. Finché il
 * banner è nella sua forma corta funziona. Poi la persona tocca **«Personalizza»** — cioè fa
 * esattamente quello che le linee guida del Garante chiedono di rendere facile — il banner cresce
 * di quattro righe, e il numero pubblicato resta quello di prima. La barra si sposta di meno di
 * quanto serve, e **il pulsante che fa incassare torna coperto**.
 *
 * PERCHÉ NON BASTAVA AGGIUNGERE UNA DIPENDENZA. La cura corta era mettere anche `mode` fra le
 * dipendenze dell'effetto. Cura oggi e non domani: un testo più lungo, una riga che va a capo su
 * uno schermo stretto, un carattere caricato in ritardo o una lingua con parole lunghe rifarebbero
 * lo stesso danno, e ognuna vorrebbe una voce in più in una lista che qualcuno deve ricordarsi di
 * aggiornare. È la forma di difetto che questa casa paga di più.
 *
 * Adesso l'altezza SEGUE l'elemento, e chi la pubblica non deve sapere perché è cambiata.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VARIABILE_ALTEZZA,
  MARGINE_SCROLL,
  altezzaDichiarata,
  paddingDiScorrimento,
  seguiAltezza,
} from '@/lib/altezza-banner';

// ─────────────────────────────────────────────────────────────────────────────
// ① I due numeri, e cosa succede quando non c'è niente da misurare.
// ─────────────────────────────────────────────────────────────────────────────

describe('quanto spazio dichiara il banner', () => {
  it('un\'altezza vera si dichiara in pixel interi', () => {
    expect(altezzaDichiarata(120)).toBe('120px');
    expect(altezzaDichiarata(120.4)).toBe('120px');
    expect(altezzaDichiarata(120.6)).toBe('121px');
  });

  it('«non l\'ho misurato» è zero DICHIARATO, non un numero inventato', () => {
    for (const niente of [undefined, null, 0, -5, NaN, Infinity]) {
      expect(altezzaDichiarata(niente as number), `${niente} deve valere zero`).toBe('0px');
    }
  });

  it('lo spazio per scorrere è l\'altezza più il respiro, e col nulla resta solo il respiro', () => {
    expect(paddingDiScorrimento(120)).toBe(`${120 + MARGINE_SCROLL}px`);
    expect(paddingDiScorrimento(undefined)).toBe(`${MARGINE_SCROLL}px`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② Il caso vero: il banner cresce, e il numero deve crescere con lui.
// ─────────────────────────────────────────────────────────────────────────────

/** Una radice finta che ricorda l'ultimo valore scritto per ogni variabile. */
function radiceFinta() {
  const scritte: Record<string, string> = {};
  return {
    scritte,
    style: { setProperty: (n: string, v: string) => { scritte[n] = v; } },
    get altezza() { return scritte[VARIABILE_ALTEZZA]; },
  };
}

/** Un osservatore finto: tiene la richiamata, così la prova può far finta che l'elemento cresca. */
function osservatoreFinto() {
  let richiamata: (() => void) | null = null;
  let spento = false;
  return {
    osserva: (_b: { offsetHeight: number }, q: () => void) => {
      richiamata = q;
      return () => { spento = true; richiamata = null; };
    },
    cresciuto: () => richiamata?.(),
    get attaccato() { return richiamata !== null; },
    get spento() { return spento; },
  };
}

describe('l\'altezza segue l\'elemento', () => {
  it('IL CASO: si tocca «Personalizza», il banner cresce, e il numero cresce con lui', () => {
    const banner = { offsetHeight: 96 };          // forma corta
    const radice = radiceFinta();
    const occhio = osservatoreFinto();

    const smetti = seguiAltezza(banner, radice, occhio.osserva);
    expect(radice.altezza, 'all\'apertura dichiara la sua altezza vera').toBe('96px');

    banner.offsetHeight = 248;                     // «Personalizza»: quattro righe in più
    occhio.cresciuto();
    expect(radice.altezza, 'dopo essere cresciuto deve dirlo').toBe('248px');

    smetti();
    expect(radice.altezza, 'chiuso il banner, la barra torna dov\'era').toBe('0px');
    expect(occhio.spento, 'e nessuno resta a guardare un elemento che non c\'è più').toBe(true);
  });

  it('senza il seguito, il difetto torna: è la stessa scena con la misura presa una volta sola', () => {
    // Questa è la forma VECCHIA, scritta qui per far vedere cosa cambia: misuro e pubblico, e basta.
    const banner = { offsetHeight: 96 };
    const radice = radiceFinta();
    radice.style.setProperty(VARIABILE_ALTEZZA, altezzaDichiarata(banner.offsetHeight));
    banner.offsetHeight = 248;
    expect(radice.altezza, 'il numero resta indietro: il pulsante torna coperto').toBe('96px');
  });

  it('se l\'elemento non c\'è, pubblica zero e non finge di aver misurato', () => {
    const radice = radiceFinta();
    const occhio = osservatoreFinto();
    const smetti = seguiAltezza(null, radice, occhio.osserva);
    expect(radice.altezza).toBe('0px');
    expect(occhio.attaccato, 'non si osserva il nulla').toBe(false);
    smetti();
    expect(radice.altezza).toBe('0px');
  });

  it('la variabile ha un nome solo, e lo conosce chi la scrive e chi la legge', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const prodotto = readFileSync(join(process.cwd(), 'components/StickyAddToCart.tsx'), 'utf8');
    const chiLaLegge = `${css}\n${prodotto}`;
    expect(chiLaLegge, 'nessuno legge la variabile che il banner pubblica').toContain(VARIABILE_ALTEZZA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ L'invariante: il banner non torna a misurarsi una volta sola.
// ─────────────────────────────────────────────────────────────────────────────

describe('l\'invariante sul banner vero', () => {
  const src = readFileSync(join(process.cwd(), 'components/CookieBanner.tsx'), 'utf8');
  const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('l\'altezza la pubblica chi la segue, non il componente a mano', () => {
    expect(senzaCommenti, 'deve passare da seguiAltezza').toMatch(/\bseguiAltezza\s*\(/);
    expect(senzaCommenti, 'il componente non deve scrivere la variabile da sé')
      .not.toMatch(new RegExp(`setProperty\\(\\s*['"\`]${VARIABILE_ALTEZZA}`));
  });

  it('non c\'è nessun numero di altezza scritto a mano nel componente', () => {
    // `${altezza + 16}px` era la forma vecchia: il respiro sommato lì dentro, lontano da chi lo
    // decide. Adesso quel numero vive in un posto solo.
    expect(senzaCommenti).not.toMatch(/\+\s*16\s*\}px/);
    expect(senzaCommenti, 'lo spazio per scorrere lo calcola la funzione').toMatch(/paddingDiScorrimento\s*\(/);
  });
});
