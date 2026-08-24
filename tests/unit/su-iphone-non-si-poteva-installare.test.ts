/**
 * Su iPhone il banner «installa l'app» non compariva mai, e non c'era nessun altro modo.
 *
 * IL CASO. Il banner si mostrava solo dopo aver ricevuto `beforeinstallprompt`, l'evento con cui il
 * browser offre l'installazione a pulsante. **Safari su iOS quell'evento non lo emette**, e nel
 * file non c'era nessun ramo alternativo: su iPhone il banner era muto, e non esisteva nessun modo
 * di scoprire che MyCity si può mettere in schermata Home. Per un marketplace di quartiere non è un
 * dettaglio: chi compra dal negozio sotto casa lo fa dal telefono, e l'icona in Home è la
 * differenza fra tornare e non tornare.
 *
 * PERCHÉ NON BASTA «MOSTRARE IL BANNER ANCHE SU iOS». Su iOS un pulsante che installa non è
 * possibile: il sistema non lo permette. Un pulsante «Installa» che non installa niente sarebbe
 * peggio del silenzio. Quindi le risposte sono **tre** e non due — pulsante, istruzioni, niente —
 * come per il resto di questa casa.
 *
 * E c'è una trappola dentro la trappola: **l'iPad si traveste da Mac.** Da iPadOS 13 il browser
 * dichiara «Macintosh» come farebbe un computer. Chi cerca solo «iPad» perde tutti gli iPad, e su
 * quelli il banner resterebbe muto esattamente come prima della cura.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { comeSiInstalla, eApple, type Situazione } from '@/lib/installabile';

const base: Situazione = {
  offertaDalBrowser: false,
  eApple: false,
  giaInstallata: false,
  giaRifiutata: false,
  visite: 3,
  visiteMinime: 3,
};

describe('le tre risposte, non due', () => {
  it('IL CASO: su iPhone, senza offerta del browser, si dicono i due gesti', () => {
    expect(comeSiInstalla({ ...base, eApple: true, offertaDalBrowser: false })).toBe('istruzioni');
  });

  it('dove il browser offre l\'installazione, si dà il pulsante', () => {
    expect(comeSiInstalla({ ...base, offertaDalBrowser: true })).toBe('pulsante');
  });

  it('fuori da Apple e senza offerta si sta zitti: nessun pulsante che non installa niente', () => {
    expect(comeSiInstalla({ ...base, eApple: false, offertaDalBrowser: false })).toBe('niente');
  });

  it('il pulsante vince sulle istruzioni quando il browser lo offre davvero', () => {
    // Un iPad su un browser che emettesse l'evento avrebbe entrambe le strade: si prende la buona.
    expect(comeSiInstalla({ ...base, eApple: true, offertaDalBrowser: true })).toBe('pulsante');
  });
});

describe('quando NON si chiede niente, e l\'ordine delle domande', () => {
  it('a chi ce l\'ha già in Home non si propone niente, nemmeno su iPhone', () => {
    expect(comeSiInstalla({ ...base, giaInstallata: true, eApple: true })).toBe('niente');
    expect(comeSiInstalla({ ...base, giaInstallata: true, offertaDalBrowser: true })).toBe('niente');
  });

  it('chi ha detto di no ha detto di no, anche se le visite crescono', () => {
    expect(comeSiInstalla({ ...base, giaRifiutata: true, eApple: true, visite: 99 })).toBe('niente');
  });

  it('sotto la soglia di visite si sta zitti su tutte le strade', () => {
    expect(comeSiInstalla({ ...base, visite: 2, eApple: true })).toBe('niente');
    expect(comeSiInstalla({ ...base, visite: 2, offertaDalBrowser: true })).toBe('niente');
  });

  it('alla soglia esatta si parla: 3 su 3 è dentro, non fuori', () => {
    expect(comeSiInstalla({ ...base, visite: 3, eApple: true })).toBe('istruzioni');
  });
});

describe('riconoscere un dispositivo Apple', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
  const IPAD_VECCHIO = 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15';
  const IPAD_TRAVESTITO = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120';

  it('iPhone e iPad che si dichiarano', () => {
    expect(eApple(IPHONE)).toBe(true);
    expect(eApple(IPAD_VECCHIO)).toBe(true);
  });

  it('L\'IPAD TRAVESTITO DA MAC: si riconosce dai punti di tocco, non dal nome', () => {
    expect(eApple(IPAD_TRAVESTITO, 5), 'un iPad dice «Macintosh» ma si tocca').toBe(true);
    expect(eApple(MAC, 0), 'un Mac vero non si tocca').toBe(false);
    expect(eApple(IPAD_TRAVESTITO, 0), 'senza tocco non si può distinguere: non si inventa').toBe(false);
  });

  it('Android non è Apple: lì l\'installazione la offre il browser', () => {
    expect(eApple(ANDROID, 5)).toBe(false);
  });

  it('una stringa vuota non fa dire di sì per sbaglio', () => {
    expect(eApple('', 10)).toBe(false);
  });
});

describe('l\'invariante sul banner vero', () => {
  const src = readFileSync(join(process.cwd(), 'components/PWAInstallBanner.tsx'), 'utf8');
  const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('la decisione la prende la funzione pura, non un `if` scritto nel componente', () => {
    expect(senzaCommenti).toMatch(/comeSiInstalla\s*\(/);
    // La forma vecchia: mostrare solo se l'evento è arrivato. È esattamente il difetto.
    expect(senzaCommenti, 'il banner non deve più dipendere dal solo evento del browser')
      .not.toMatch(/setShow\(\s*!!promptEvent/);
  });

  it('il ramo delle istruzioni esiste, e non offre un pulsante che non installa niente', () => {
    expect(senzaCommenti, 'manca il ramo per iPhone').toMatch(/modo === 'istruzioni'/);
    expect(senzaCommenti, 'il pulsante Installa deve comparire solo dove installa davvero')
      .toMatch(/modo === 'pulsante' \?\s*<Button/);
  });

  it('i due gesti di iOS sono scritti per esteso: «Condividi» e «Aggiungi a Home»', () => {
    // Senza i nomi veri delle due voci del menu, le istruzioni non servono a niente.
    expect(src).toMatch(/Condividi/);
    expect(src).toMatch(/Aggiungi a Home/);
  });

  it('l\'iPad travestito si riconosce anche nel componente: si leggono i punti di tocco', () => {
    expect(senzaCommenti).toMatch(/maxTouchPoints/);
  });
});
