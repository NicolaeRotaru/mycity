/**
 * 6/9/2026 — DUE COSE STORTE NELLA VETRINA DEL NEGOZIO, TUTTE E DUE NATE ALLO
 * STESSO MODO: UNA RIGA SCRITTA UNA VOLTA E MAI PIÙ CONTROLLATA.
 *
 * ① IL TEMA «EDITORIALE» RIMPICCIOLIVA IL TESTO DEL NEGOZIANTE.
 *
 *    `.store-richtext` è il testo libero che il negoziante scrive nella sua
 *    vetrina: la presentazione, la storia, gli avvisi — cioè il testo lungo,
 *    quello che si legge davvero. Il sito fissa il testo di lettura a 16 pixel
 *    (--text-base). Il tema «editoriale» lo portava a 0.95rem, cioè 15,2
 *    pixel: chi sceglie un tema che si chiama «editoriale» si aspetta di
 *    leggere MEGLIO, e otteneva lettere più piccole del resto del sito.
 *    L'aria da rivista la fa l'interlinea — 1.75, che resta — e la larghezza
 *    della colonna, non il carattere rimpicciolito.
 *
 * ② UNA VARIABILE DI COLORE CHE NESSUNO LEGGEVA.
 *
 *    Le due pagine della vetrina scrivevano `--store-accent` sul contenitore, e
 *    un commento nel foglio di stile la presentava come il modo in cui il
 *    colore del negozio sopravvive ai temi. Cercandola in tutto il progetto:
 *    le due dichiarazioni e il commento, e nessuno che la legga. Le sezioni il
 *    colore lo ricevono dalla prop `ctx.accent`. Era codice morto che
 *    documentava un meccanismo inesistente: chi avesse scritto una sezione
 *    nuova fidandosi del commento avrebbe usato var(--store-accent) e ottenuto
 *    un colore vuoto — cioè nessun colore.
 *
 * Sono difetti di gravità minore e la prova legge i file veri: diventa rossa se
 * qualcuno rimette il testo sotto la misura di lettura, o riporta in vita la
 * variabile morta senza darle un lettore.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const leggi = (p: string) => readFileSync(p, 'utf8');

const GLOBALS = leggi('app/globals.css');
const PAGINE_VETRINA = ['app/store/[id]/page.tsx', 'app/store/[id]/[slug]/page.tsx'];

/** Il valore di una variabile dichiarata in app/globals.css. */
function token(nome: string): string {
  const m = GLOBALS.match(new RegExp(`${nome}\\s*:\\s*([^;]+);`));
  expect(m, `in app/globals.css non c'è più ${nome}: questa prova non misura niente`).toBeTruthy();
  return m![1].trim();
}

/** Una misura CSS in pixel: `1rem`, `0.95rem`, `16px`, o una var() da risolvere. */
function inPixel(misura: string): number {
  const rinvio = misura.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (rinvio) return inPixel(token(rinvio[1]));
  const rem = misura.match(/^([\d.]+)rem$/);
  if (rem) return Number(rem[1]) * 16;
  const px = misura.match(/^([\d.]+)px$/);
  if (px) return Number(px[1]);
  throw new Error(`non so leggere questa misura: ${misura}`);
}

describe('① il testo che il negoziante scrive nella sua vetrina si legge', () => {
  /** Il corpo della regola del tema «editoriale» sul testo libero della vetrina. */
  const regola = (() => {
    const m = GLOBALS.match(/\[data-theme='editoriale'\]\s+\.store-richtext\s*\{([^}]*)\}/);
    expect(
      m,
      'in app/globals.css non c\'è più la regola del tema editoriale sul testo della vetrina',
    ).toBeTruthy();
    return m![1];
  })();

  const misura = (() => {
    const m = regola.match(/font-size:\s*([^;]+);/);
    expect(m, 'il tema editoriale non dichiara più una misura del testo').toBeTruthy();
    return m![1].trim();
  })();

  it('nel tema «editoriale» non scende sotto la misura di lettura del sito', () => {
    const base = inPixel(token('--text-base'));
    expect(
      inPixel(misura),
      `il tema «editoriale» scrive il testo del negoziante a ${inPixel(misura)} pixel mentre il sito ` +
        `legge a ${base}: chi sceglie quel tema si ritrova le lettere più piccole del resto del sito`,
    ).toBeGreaterThanOrEqual(base);
  });

  it('e l\'aria da rivista la fa l\'interlinea, che resta larga', () => {
    const m = regola.match(/line-height:\s*([\d.]+)/);
    expect(m, 'il tema editoriale non dichiara più l\'interlinea: era la parte giusta').toBeTruthy();
    expect(
      Number(m![1]),
      'l\'interlinea del tema editoriale si è stretta: era quella a dare l\'effetto rivista',
    ).toBeGreaterThanOrEqual(1.6);
  });
});

describe('② nella vetrina non restano variabili di colore che nessuno legge', () => {
  /** Ogni riga del progetto che nomina --store-accent, cercata come farebbe una persona. */
  function dove(): string[] {
    const fuori = execFileSync(
      'git',
      ['grep', '-n', '--', 'store-accent', '--', 'app', 'components', 'lib'],
      { encoding: 'utf8' },
    ).trim();
    return fuori === '' ? [] : fuori.split('\n');
  }

  it('la variabile morta non è più scritta dalle due pagine della vetrina', () => {
    for (const pagina of PAGINE_VETRINA) {
      expect(
        leggi(pagina),
        `${pagina} torna a scrivere --store-accent, e continua a non leggerla nessuno`,
      ).not.toContain('--store-accent');
    }
  });

  it('e se qualcuno la rimette, deve anche leggerla da qualche parte', () => {
    const righe = dove();
    // Chi la SCRIVE la dichiara (`'--store-accent':` in uno style, o `--store-accent:` nel CSS);
    // chi la LEGGE la chiede con var(--store-accent). Una senza l'altra è codice morto.
    const scritture = righe.filter((r) => /--store-accent'?\s*\]?\s*:/.test(r));
    const letture = righe.filter((r) => /var\(\s*--store-accent/.test(r));

    if (scritture.length > 0) {
      expect(
        letture.length,
        'qualcuno ha rimesso --store-accent sul contenitore della vetrina ma nessuno la legge: ' +
          'è codice morto, e chi scriverà una sezione nuova fidandosi otterrà un colore vuoto.\n' +
          righe.join('\n'),
      ).toBeGreaterThan(0);
    }
  });

  it('le pagine della vetrina passano ancora il colore del negozio, dove serve davvero', () => {
    // Toglierne la variabile morta non deve portare via il colore vero: quello
    // arriva per prop, e nella vetrina si vede sull'avviso del negoziante.
    for (const pagina of PAGINE_VETRINA) {
      expect(
        leggi(pagina),
        `${pagina} non usa più il colore del negozio: l'avviso torna grigio come tutti gli altri`,
      ).toContain('accent');
    }
  });
});
