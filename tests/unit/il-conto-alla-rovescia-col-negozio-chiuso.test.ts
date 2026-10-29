/**
 * «Ordina entro 02:14:31 e arriva oggi in 30-60 min» — col negozio chiuso.
 *
 * IL CASO. Sulla scheda prodotto c'è un conto alla rovescia che promette la consegna in giornata.
 * Compariva ogni volta che il prodotto era disponibile e il negozio offriva la consegna veloce.
 * **Nessuno guardava se il negozio era aperto.**
 *
 * Quindi: negozio chiuso di mattina — giorno di chiusura, prima dell'apertura, domenica — e la
 * scheda scrive «arriva oggi in 30-60 min», mentre la pagina di quello stesso negozio, due clic più
 * in là, dice «Chiuso ora». Il percorso prosegue: carrello, indirizzo, pagamento. **Il muro arriva
 * alla fine**, dal server, al clic di conferma: «Il negozio è chiuso in questo momento».
 *
 * Un muro all'ultimo passo è la forma più cara di «no»: la persona ha già scelto, già scritto
 * l'indirizzo, già deciso come pagare.
 *
 * PERCHÉ NON BASTAVA SPEGNERE IL CONTO ALLA ROVESCIA. Il componente aveva due risposte: consegna
 * veloce, oppure «Consegna in 2-3 giorni». Mettere il negozio chiuso nella seconda sarebbe stato
 * sbagliato di un'altra maniera: un negozio chiuso stamattina non è un prodotto che ci mette due
 * giorni — riapre alle 16. Dire «2-3 giorni» a chi potrebbe comprare fra due ore costa un ordine
 * invece di salvarlo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { haOrari, promessaDiConsegna, quandoRiapre, rigaNegozioChiuso } from '@/lib/promessa-consegna';

// Un negozio normale: mattina e pomeriggio, domenica chiuso, lunedì chiuso di mattina.
const ORARI = {
  sun: [],
  mon: [['15:00', '19:30']],
  tue: [['08:30', '13:00'], ['15:00', '19:30']],
  wed: [['08:30', '13:00'], ['15:00', '19:30']],
  thu: [['08:30', '13:00'], ['15:00', '19:30']],
  fri: [['08:30', '13:00'], ['15:00', '19:30']],
  sat: [['08:30', '13:00']],
};
// Martedì 25 agosto 2026.
const martedi = (h: number, m = 0) => new Date(2026, 7, 25, h, m);
const domenica = (h: number, m = 0) => new Date(2026, 7, 23, h, m);
const sabato = (h: number, m = 0) => new Date(2026, 7, 22, h, m);

// ─────────────────────────────────────────────────────────────────────────────
// ① Le tre risposte, e quale vince.
// ─────────────────────────────────────────────────────────────────────────────

describe('cosa può promettere la scheda', () => {
  it('negozio aperto e prodotto pronto: si può promettere oggi', () => {
    expect(promessaDiConsegna({ idoneoExpress: true, disponibile: true, orari: ORARI, adesso: martedi(10) }))
      .toEqual({ tipo: 'express' });
  });

  it('IL CASO: negozio CHIUSO — non si promette oggi, nemmeno col prodotto pronto', () => {
    const p = promessaDiConsegna({ idoneoExpress: true, disponibile: true, orari: ORARI, adesso: martedi(7) });
    expect(p.tipo).toBe('chiuso');
  });

  it('«chiuso» vince su tutto: è la domanda che veniva per ultima e deve venire per prima', () => {
    // Prodotto pronto e consegna veloce attiva: prima bastava per scrivere «arriva oggi».
    // Martedì il negozio fa 08:30-13:00 e 15:00-19:30. Queste quattro ore sono tutte fuori.
    const pronto = { idoneoExpress: true, disponibile: true, orari: ORARI };
    for (const ora of [7, 14, 20, 23]) {
      expect(promessaDiConsegna({ ...pronto, adesso: martedi(ora) }).tipo, `martedì alle ${ora}`).toBe('chiuso');
    }
    // E queste due sono dentro.
    for (const ora of [10, 16]) {
      expect(promessaDiConsegna({ ...pronto, adesso: martedi(ora) }).tipo, `martedì alle ${ora}`).toBe('express');
    }
  });

  it('negozio aperto ma prodotto non pronto: consegna in giornate, non «chiuso»', () => {
    expect(promessaDiConsegna({ idoneoExpress: true, disponibile: false, orari: ORARI, adesso: martedi(10) }))
      .toEqual({ tipo: 'standard' });
    expect(promessaDiConsegna({ idoneoExpress: false, disponibile: true, orari: ORARI, adesso: martedi(10) }))
      .toEqual({ tipo: 'standard' });
  });

  it('un negozio SENZA orari non è un negozio chiuso: si torna a com\'era', () => {
    // È la stessa scelta che fa il server, che senza orari lascia passare l'ordine.
    expect(promessaDiConsegna({ idoneoExpress: true, disponibile: true, adesso: martedi(4) }))
      .toEqual({ tipo: 'express' });
    expect(promessaDiConsegna({ idoneoExpress: true, disponibile: true, orari: {}, adesso: martedi(4) }))
      .toEqual({ tipo: 'express' });
    expect(promessaDiConsegna({ idoneoExpress: true, disponibile: true, orari: 'ciao', adesso: martedi(4) }))
      .toEqual({ tipo: 'express' });
  });
});

describe('riconoscere se ci sono degli orari', () => {
  it('sì quando almeno un giorno ne ha', () => {
    expect(haOrari(ORARI)).toBe(true);
    expect(haOrari({ mon: [['09:00', '12:00']] })).toBe(true);
  });
  it('no per tutto il resto', () => {
    for (const niente of [null, undefined, {}, 'ciao', 42, { sun: [], mon: [] }]) {
      expect(haOrari(niente), String(niente)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② Quando riapre — e quando non si può dire.
// ─────────────────────────────────────────────────────────────────────────────

describe('quando riapre', () => {
  it('più tardi oggi: si dice l\'ora', () => {
    expect(quandoRiapre(ORARI, martedi(7))).toBe('alle 08:30');
    expect(quandoRiapre(ORARI, martedi(14))).toBe('alle 15:00');
  });

  it('a giornata finita: domani, con l\'ora vera di domani', () => {
    // Sabato sera → domenica è chiusa → si salta a lunedì, che apre alle 15:00.
    expect(quandoRiapre(ORARI, sabato(20))).toBe('lunedì alle 15:00');
  });

  it('il giorno dopo si chiama «domani», non col suo nome', () => {
    expect(quandoRiapre(ORARI, domenica(10))).toBe('domani alle 15:00');
  });

  it('IL CASO: senza orari non si inventa un\'ora', () => {
    expect(quandoRiapre(null, martedi(7))).toBeNull();
    expect(quandoRiapre({}, martedi(7))).toBeNull();
  });

  it('un negozio che non apre per una settimana non ha un «riapre»', () => {
    // Ha degli orari (quindi è «chiuso», non «non lo so»), ma non riapre entro sei giorni.
    const soloIeri = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
    expect(quandoRiapre(soloIeri, martedi(7))).toBeNull();
  });
});

describe('la riga che legge la persona', () => {
  it('dice che è chiuso E quando riapre', () => {
    const r = rigaNegozioChiuso('alle 15:00');
    expect(r).toMatch(/chiuso/i);
    expect(r).toContain('15:00');
  });

  it('senza orario dice solo che è chiuso: nessuna ora inventata', () => {
    const r = rigaNegozioChiuso(null);
    expect(r).toMatch(/chiuso/i);
    expect(r).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ Gli invarianti sul codice vero.
// ─────────────────────────────────────────────────────────────────────────────

describe('l\'invariante sul conto alla rovescia', () => {
  /*
   * 29/10/2026 — Il conto alla rovescia non c'è più (regola di Nicola, consegna.promessa): il
   * componente chiede la riga a `rigaConsegnaDellaScheda` (lib/promessa-consegna), che decide con
   * `promessaDiConsegna`. Gli invarianti seguono la decisione dove vive adesso, e restano due:
   * la decisione è della funzione, e «chiuso» viene prima della frase della consegna normale.
   * Il comportamento nel browser, dopo il caricamento, lo prova
   * tests/unit/le-frasi-della-consegna-non-tornano-indietro.test.tsx.
   */
  const togli = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
  const componente = togli(readFileSync(join(process.cwd(), 'components/ui/DeliveryCutoff.tsx'), 'utf8'));
  const libreria = togli(readFileSync(join(process.cwd(), 'lib/promessa-consegna.ts'), 'utf8'));
  const inizio = libreria.indexOf('export function rigaConsegnaDellaScheda(');
  const riga = libreria.slice(inizio);

  it('la decisione la prende la funzione, non un `if` scritto nel componente', () => {
    expect(componente).toMatch(/rigaConsegnaDellaScheda\(/);
    expect(componente, 'il componente non deve rifarsi la decisione da solo').not.toMatch(/isOpenNow|DEFAULT_CUTOFF_HOUR|STANDARD_ETA_LABEL/);
    expect(inizio, 'manca rigaConsegnaDellaScheda in lib/promessa-consegna').toBeGreaterThan(-1);
    expect(riga).toMatch(/promessaDiConsegna\(/);
  });

  it('il ramo del negozio chiuso esiste e viene PRIMA della frase della consegna normale', () => {
    expect(riga, 'manca il ramo del negozio chiuso').toMatch(/\.tipo === 'chiuso'/);
    const chiuso = riga.indexOf(".tipo === 'chiuso'");
    const normale = riga.indexOf('CONSEGNA_ALL_ORA_CHE_SCEGLI', chiuso);
    expect(normale, 'il negozio chiuso non deve finire dentro «all\'ora che scegli» senza dire che è chiuso').toBeGreaterThan(chiuso);
    expect(riga, 'la scheda non promette più «2-3 giorni»').not.toMatch(/STANDARD_ETA_LABEL/);
  });

  it('il componente riceve davvero gli orari, e li passa alla decisione', () => {
    expect(componente).toMatch(/storeHours/);
    expect(componente).toMatch(/orari:\s*storeHours/);
  });
});

describe('l\'invariante sulla scheda prodotto', () => {
  const src = readFileSync(join(process.cwd(), 'app/product/[id]/page.tsx'), 'utf8');
  const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('gli orari del negozio vengono chiesti al database', () => {
    // Senza la colonna nel select, il componente riceverebbe undefined e si tornerebbe al difetto.
    expect(senzaCommenti, 'store_hours non è più nella query').toMatch(/store_hours/);
  });

  it('e vengono passati al conto alla rovescia', () => {
    expect(senzaCommenti).toMatch(/storeHours=\{/);
  });
});
