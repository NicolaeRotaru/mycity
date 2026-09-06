import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 6/9/2026 — IL MARCHIO CAMBIAVA FACCIA DA UN TELEFONO ALL'ALTRO.
 *
 * L'icona del sito — quella nella scheda del browser, e quella che resta sulla
 * schermata Home di chi si installa MyCity — disegnava la sigla «My» come
 * TESTO, chiedendo `font-family="system-ui"`. Vuol dire: usa il carattere di
 * chi guarda. Su un iPhone diventava San Francisco, su Android Roboto, su
 * Linux DejaVu. Nessuno dei tre e' il carattere del marchio (Fraunces), e il
 * segno che la gente vede piu' spesso non era mai lo stesso due volte.
 *
 * Ora le lettere sono TRACCIATI, ricavati una volta sola da
 * `app/Fraunces-ExtraBold.ttf`: un disegno fisso, identico ovunque, che non
 * dipende da cosa e' installato sul dispositivo.
 *
 * Nello stesso punto mancava anche il favicon classico: browser vecchi e
 * parecchi aggregatori chiedono `/favicon.ico` da soli, e li' rispondeva un
 * 404. Adesso il file c'e'.
 *
 * ── Cosa prova, davvero ────────────────────────────────────────────────────
 * Non cerca una parola nel file. Sul favicon APRE i byte e legge l'indice del
 * formato ICO: quante immagini contiene, di che misura, e se i pezzi dichiarati
 * stanno davvero dentro il file. Un file rinominato o troncato non passa.
 *
 * ⚪ Quello che da qui NON ho potuto verificare: come il browser disegna
 * l'icona sulla schermata Home di un telefono vero. Serve un dispositivo.
 */

const RADICE = process.cwd();

/** Le icone che arrivano davvero a chi visita il sito. */
const ICONE = [
  'public/icon-192.svg',
  'public/icon-512.svg',
  // L'originale del design system: se resta indietro, la prossima rigenerazione
  // riporta dentro il carattere di sistema.
  'docs/mockup/assets/logo-icon.svg',
];

describe('l\'icona del sito', () => {
  it.each(ICONE)('%s non affida il marchio al carattere di chi guarda', (relativo) => {
    // I commenti non disegnano niente: raccontano solo la storia del file.
    // Si tolgono, altrimenti la prova inciampa sulla parola che spiega il
    // difetto invece che sul difetto.
    const svg = readFileSync(join(RADICE, relativo), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

    expect(
      /font-family/i.test(svg),
      `${relativo} chiede ancora un carattere: il marchio cambia faccia su ogni dispositivo`,
    ).toBe(false);

    expect(
      /<text[\s>]/i.test(svg),
      `${relativo} disegna ancora le lettere come testo invece che come tracciati`,
    ).toBe(false);

    expect(
      /<path[\s>]/i.test(svg),
      `${relativo} non contiene nessun tracciato: il «My» e' sparito`,
    ).toBe(true);
  });
});

describe('il favicon classico', () => {
  const percorso = join(RADICE, 'public/favicon.ico');

  it('esiste all\'indirizzo che i lettori vecchi chiedono da soli', () => {
    expect(existsSync(percorso), 'manca public/favicon.ico: /favicon.ico risponde 404').toBe(true);
  });

  it('e\' un vero file ICO, con le misure che servono a una scheda del browser', () => {
    const b = readFileSync(percorso);

    expect(b.readUInt16LE(0), 'i primi due byte di un ICO valgono 0').toBe(0);
    expect(b.readUInt16LE(2), 'il tipo di un ICO vale 1 (icona)').toBe(1);

    const quante = b.readUInt16LE(4);
    expect(quante, 'un ICO senza immagini dentro non serve a niente').toBeGreaterThan(0);

    const misure: number[] = [];
    for (let i = 0; i < quante; i++) {
      const voce = 6 + 16 * i;
      // 0 nell'indice ICO vuol dire 256 pixel.
      const lato = b.readUInt8(voce) || 256;
      const lunghezza = b.readUInt32LE(voce + 8);
      const inizio = b.readUInt32LE(voce + 12);
      expect(
        inizio + lunghezza,
        `l'immagine ${lato}x${lato} dichiara byte che nel file non ci sono: file troncato`,
      ).toBeLessThanOrEqual(b.length);
      expect(lunghezza, `l'immagine ${lato}x${lato} e' vuota`).toBeGreaterThan(0);
      misure.push(lato);
    }

    // 16 e' la misura della scheda del browser, 32 quella dei collegamenti sul
    // desktop: sono le due che si vedono davvero.
    expect(misure, `dentro il favicon ci sono le misure ${misure.join('/')}`).toContain(16);
    expect(misure, `dentro il favicon ci sono le misure ${misure.join('/')}`).toContain(32);
  });
});

describe('il guscio del sito', () => {
  it('dichiara il favicon classico fra le sue icone', () => {
    const layout = readFileSync(join(RADICE, 'app/layout.tsx'), 'utf8');
    expect(
      layout.includes('/favicon.ico'),
      'app/layout.tsx non nomina /favicon.ico: il file esiste ma il sito non lo dichiara',
    ).toBe(true);
  });
});
