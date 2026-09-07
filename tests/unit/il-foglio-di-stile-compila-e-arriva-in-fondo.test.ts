import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

/**
 * 6/9/2026 — IL FOGLIO DI STILE È USCITO ROTTO E NESSUNA PROVA SE N'È ACCORTA.
 *
 * ── Cosa è successo ─────────────────────────────────────────────────────────────────────────────
 * Riscrivendo un commento dentro `app/globals.css` è rimasto un `*\/` di troppo: il commento si
 * chiudeva una riga prima del previsto e la riga dopo — ` * ====== *\/` — restava fuori, dove il
 * compilatore si aspetta un selettore. Da lì in giù il foglio non era più CSS valido: `tailwindcss`
 * moriva con «Unexpected '/'» e NON scriveva nessun file. Zero righe di stile vuol dire il sito
 * senza un colore, senza un margine, senza un bottone al posto giusto.
 *
 * ── Perché è passato ────────────────────────────────────────────────────────────────────────────
 * È passato per un commit e per 3573 prove verdi. Nessuna di quelle prove COMPILAVA il foglio: lo
 * leggevano come testo e ci cercavano dentro delle parole. Un file può contenere tutte le parole
 * giuste ed essere impossibile da compilare — l'ha trovato per caso una squadra che misurava altro.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────────
 * Lancia il compilatore vero (`tailwindcss -i app/globals.css -o …`, circa due secondi) e pretende:
 *   ① la compilazione riesce — nessun errore, uscita 0, il file di destinazione esiste davvero;
 *   ② quello che esce non è vuoto né quasi vuoto (oggi 11.238 righe, il pavimento è 5.000);
 *   ③ le regole che nel sorgente stanno IN FONDO sono VIVE nel foglio compilato.
 *
 * ── Perché ③ non cerca una parola nel testo compilato ───────────────────────────────────────────
 * Perché sarebbe un verde bugiardo, ed è stato misurato: aprendo un commento a metà file (tolto il
 * `*\/` di `/* Moderno: … `) le regole dei temi finiscono DENTRO il commento, restano nel file
 * compilato come testo commentato, e una ricerca di parole le trova lo stesso. Il compilatore esce
 * 0, escono 11.229 righe invece di 11.238 — nove in meno, nessun pavimento le prende — e i temi
 * della vetrina sono morti. Per questo il foglio compilato viene PARSATO: si guardano solo le
 * regole vere con dentro almeno una dichiarazione, e ciò che è commentato non conta.
 *
 * ── Cosa NON prova ──────────────────────────────────────────────────────────────────────────────
 * Non guarda come appare la pagina: che i colori siano quelli giusti, che il contrasto regga o che
 * una regola vinca sull'altra è mestiere delle prove che montano i componenti in un browser finto
 * (`il-bordo-del-campo-si-vede.test.ts`). Copre le tre regole-sentinella qui sotto, non le altre
 * 600 righe una per una. Non copre i fogli sotto `design-system/tokens/`, qui ricopiati a mano. E
 * non dice se una classe scritta dentro un `.tsx` esiste davvero.
 *
 * ── Costo ───────────────────────────────────────────────────────────────────────────────────────
 * ~2,5 secondi a esecuzione: è l'unica prova della cartella che accende un compilatore. Il tetto di
 * tempo è largo (2 minuti) perché su una macchina di integrazione fredda il primo giro è più lento.
 */

/**
 * La radice si ricava da dove sta QUESTO file, non da `process.cwd()`: così la prova compila sempre
 * il foglio del suo repo, anche se qualcuno lancia vitest da un'altra cartella. Lanciata dal posto
 * sbagliato, una prova che si fida della cartella corrente non trova il compilatore e diventa rossa
 * per il motivo sbagliato — capitato davvero mentre la si collaudava.
 */
const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SORGENTE = 'app/globals.css';
const COMPILATORE = join(RADICE, 'node_modules', '.bin', 'tailwindcss');

/** Oggi ne escono 11.238: sotto questo numero è successo qualcosa di grosso. */
const PAVIMENTO_RIGHE = 5_000;

/**
 * Sentinelle: regole che nel sorgente stanno dopo la riga 500 su 612. Se una rottura a metà file si
 * mangia la coda, il compilatore non se ne lamenta — queste spariscono e basta.
 */
const REGOLE_IN_FONDO = [
  "[data-theme='moderno'] .rounded-2xl",
  "[data-theme='caldo'] .bg-white",
  // L'ultimissima regola del file: prova che il compilatore è arrivato in fondo.
  'input.border-cream-300',
];

type Compilazione = {
  uscita: number | null;
  testo: string;
  css: string | null;
};

/**
 * Ogni giro scrive in una cartella temporanea NUOVA. Riusare sempre lo stesso percorso sarebbe la
 * trappola classica: quando la compilazione fallisce non scrive niente, resterebbe lì il file buono
 * del giro prima e la prova passerebbe verde leggendo il lavoro di ieri.
 */
function compilaIlFoglioDiStile(): Compilazione {
  const cartella = mkdtempSync(join(tmpdir(), 'mycity-css-'));
  const uscitaCss = join(cartella, 'compilato.css');
  try {
    const esecuzione = spawnSync(COMPILATORE, ['-i', SORGENTE, '-o', uscitaCss], {
      cwd: RADICE,
      encoding: 'utf8',
      timeout: 120_000,
    });
    return {
      uscita: esecuzione.status,
      testo: `${esecuzione.stdout ?? ''}${esecuzione.stderr ?? ''}`.trim(),
      css: existsSync(uscitaCss) ? readFileSync(uscitaCss, 'utf8') : null,
    };
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

/** I selettori che nel foglio compilato hanno davvero un corpo con dentro delle dichiarazioni. */
function selettoriVivi(css: string): Set<string> {
  const vivi = new Set<string>();
  postcss.parse(css).walkRules((regola) => {
    if (regola.nodes.some((nodo) => nodo.type === 'decl')) {
      for (const selettore of regola.selectors) vivi.add(selettore.replace(/\s+/g, ' ').trim());
    }
  });
  return vivi;
}

describe('app/globals.css si compila davvero', () => {
  it(
    'esce un foglio di stile pieno, e le regole in fondo al file sono vive',
    () => {
      expect(
        existsSync(COMPILATORE),
        `Manca ${COMPILATORE}: le dipendenze non sono installate, lancia "npm ci".`,
      ).toBe(true);

      const { uscita, testo, css } = compilaIlFoglioDiStile();

      // ① La compilazione riesce.
      expect(
        uscita,
        `Il compilatore ha rifiutato ${SORGENTE}. Quello che ha detto:\n${testo.slice(0, 2_000)}`,
      ).toBe(0);
      expect(
        css,
        `Il compilatore non ha scritto nessun file. Quello che ha detto:\n${testo}`,
      ).not.toBe(null);

      // ② Non è vuoto, e nemmeno quasi vuoto.
      const righe = (css as string).split('\n').length;
      expect(
        righe,
        `Sono uscite ${righe} righe di CSS: meno del pavimento di ${PAVIMENTO_RIGHE}. Il foglio è ` +
          'stato troncato, oppure il compilatore non trova più i file da scandagliare.',
      ).toBeGreaterThanOrEqual(PAVIMENTO_RIGHE);

      // ③ Il compilatore è arrivato in fondo al sorgente, e quelle regole sono vive (non commentate).
      const vivi = selettoriVivi(css as string);
      for (const regola of REGOLE_IN_FONDO) {
        expect(
          vivi.has(regola),
          `La regola «${regola}» non è viva nel foglio compilato. Nel sorgente sta in fondo: o la ` +
            'coda non è arrivata, o è finita dentro un commento lasciato aperto più su.',
        ).toBe(true);
      }
    },
    120_000,
  );
});
