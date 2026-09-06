/**
 * 6/9/2026 — OGNI PAGINA CORTA SCORREVA A VUOTO.
 *
 * Il contenuto principale di ogni pagina — il `<main>` di app/layout.tsx — era
 * dichiarato «alto almeno una schermata intera» (`min-h-screen`). Ma sopra di
 * lui, nello stesso flusso, c'è la barra in alto (striscia degli annunci, riga
 * del logo e della ricerca, barra delle categorie: circa 144 pixel, che il
 * foglio di stile chiama --header-height) e sotto di lui c'è il piè di pagina
 * più lo spazio che il corpo riserva alla barra a schede del telefono
 * (--tabbar-height).
 *
 * Una schermata intera PIÙ quello che sta sopra PIÙ quello che sta sotto fa
 * sempre più di una schermata. Quindi il documento superava sempre l'altezza
 * dello schermo, anche su una pagina con due righe dentro: il carrello vuoto,
 * la pagina non trovata, la conferma d'ordine. La persona vedeva una fascia di
 * fondo vuoto e doveva scorrerla per arrivare al piè di pagina — su una pagina
 * che di contenuto ne aveva due righe.
 *
 * LA CURA. Il minimo non è più una schermata intera: è una schermata MENO
 * quello che sta sopra e sotto. Così una pagina corta finisce esattamente dove
 * finisce lo schermo.
 *
 * PERCHÉ UNA CLASSE NEL FOGLIO DI STILE E NON UN VALORE FRA PARENTESI QUADRE.
 * La misura è fatta di due variabili che vivono in app/globals.css e cambiano
 * con la larghezza (--tabbar-height vale 0 da 768 pixel in su): scritta lì sta
 * accanto a loro e non dipende da come lo strumento delle classi interpreta un
 * `calc` scritto fra parentesi quadre.
 *
 * Questa prova legge i due file veri. Diventa rossa se qualcuno rimette
 * `min-h-screen` sul contenuto principale, o se la regola smette di togliere
 * quello che sta sopra e sotto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const leggi = (p: string) => readFileSync(p, 'utf8');

const LAYOUT = leggi('app/layout.tsx');
const GLOBALS = leggi('app/globals.css');

/** Il nome della classe, scritto una volta sola: le due metà non possono divergere. */
const CLASSE = 'contenuto-almeno-una-schermata';

/** Il `<main>` di app/layout.tsx, preso per intero dal sorgente. */
function contenutoPrincipale(): string {
  const m = LAYOUT.match(/<main[^>]*id="main-content"[^>]*>/);
  expect(
    m,
    'in app/layout.tsx non c\'è più il <main id="main-content">: questa prova non guarda niente',
  ).toBeTruthy();
  return m![0];
}

/** Il corpo della regola CSS della classe, letto da app/globals.css. */
function regolaDellaClasse(): string {
  const m = GLOBALS.match(new RegExp(`\\.${CLASSE}\\s*\\{([^}]*)\\}`));
  expect(
    m,
    `in app/globals.css non c'è più la regola .${CLASSE}: il contenuto principale resta senza altezza minima`,
  ).toBeTruthy();
  return m![1];
}

describe('il contenuto principale non è più alto di quanto ci sta nello schermo', () => {
  it('non chiede più una schermata intera per sé solo', () => {
    expect(
      contenutoPrincipale(),
      'il <main> torna a essere alto almeno una schermata: sommato alla barra in alto e al piè di ' +
        'pagina, ogni pagina corta torna a scorrere a vuoto',
    ).not.toMatch(/\bmin-h-screen\b/);
  });

  it('usa la regola che toglie quello che gli sta sopra e sotto', () => {
    expect(
      contenutoPrincipale(),
      `il <main> non porta più la classe ${CLASSE}: resta senza nessuna altezza minima`,
    ).toContain(CLASSE);
  });

  it('la regola parte da una schermata e toglie la barra in alto e quella a schede', () => {
    const regola = regolaDellaClasse();

    expect(regola, 'la regola non dichiara più un\'altezza minima').toMatch(/min-height:/);
    expect(regola, 'la misura non parte più dall\'altezza dello schermo').toContain('100vh');

    for (const [variabile, chi] of [
      ['--header-height', 'la barra in alto'],
      ['--tabbar-height', 'la barra a schede del telefono'],
    ] as const) {
      expect(
        regola.replace(/\s+/g, ' '),
        `dalla schermata non si toglie più ${chi} (${variabile}): quella pagina torna a scorrere a vuoto`,
      ).toMatch(new RegExp(`-\\s*var\\(\\s*${variabile}\\s*\\)`));
    }
  });

  it('le due variabili che toglie esistono davvero nel foglio di stile', () => {
    // Una `var()` che non esiste fa saltare tutto il `calc`, e con lui l'altezza
    // minima: il difetto tornerebbe in silenzio, senza che niente diventi rosso.
    for (const variabile of ['--header-height', '--tabbar-height']) {
      expect(
        GLOBALS,
        `${variabile} non è più dichiarata: il calc dell'altezza minima non si risolve e cade tutto`,
      ).toMatch(new RegExp(`${variabile}:\\s*\\S`));
    }
  });
});
