/**
 * Il campo che fa ingrandire la pagina appena lo tocchi, e non torna indietro.
 *
 * Safari su iPhone ingrandisce la pagina quando si mette a fuoco un campo il cui testo è sotto i
 * 16px, e **non torna indietro da solo**: la persona resta con la pagina zoomata e deve pizzicare
 * per rimetterla a posto. Sulla ricerca in cima a ogni pagina, o sul campo del codice sconto dentro
 * il checkout, è una frizione che si paga a ogni tocco — e il negoziante lavora dal telefono.
 *
 * IL NUMERO, E PERCHÉ IL REPERTO NE DICEVA SETTE. La scheda ne elencava sette, campionati.
 * Rimisurato il 24/8: **63 campi di testo su 97**. Il primo metro che ho scritto ne trovava UNO
 * solo, ed è l'errore più pericoloso dei quattro che ho fatto oggi, perché sbagliava dalla parte
 * comoda: avrei chiuso un reperto da 63 casi dicendo che ne aveva uno. La causa: cercavo il tag con
 * `<input[^>]*>`, e `[^>]*` si ferma sul primo `>` che incontra — che dentro un attributo JSX è la
 * freccia di `onChange={(e) => …}`, molto prima di `className`. Qui il tag si chiude al `>` di
 * livello ZERO, contando graffe e virgolette.
 *
 * LA CURA STA NEL CSS, NON IN 63 FILE. `app/globals.css` porta un pavimento a 16px per i campi che
 * usano le due classi piccole, sui dispositivi a tocco. Un pavimento scritto una volta vale anche
 * per il campo che qualcuno aggiungerà domani; toccare 63 file cura oggi e non domani.
 *
 * QUESTA PROVA È IL FRENO SUL BUCO DEL PAVIMENTO. Il pavimento nomina due classi. Se domani un
 * campo nasce con `text-[13px]`, quella classe non è nominata e il pavimento non lo copre: la prova
 * diventa rossa. Le due liste non divergono in silenzio, perché qui la lista NON è ricopiata — si
 * legge da `globals.css`.
 *
 * E che leggerla serva NON è un'opinione, è misurato con due mutazioni appaiate: ① ricopiando la
 * lista dentro la prova E togliendo `input.text-sm` dal CSS, il buco passa VERDE (11 su 11);
 * ② lasciando la lista letta dal file e facendo lo stesso buco, la prova diventa ROSSA. È la
 * differenza fra un freno e un cartello.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RADICE = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
// Il metro: dove finisce davvero un tag JSX.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Il testo del tag che comincia a `inizio`, fino al `>` di livello ZERO.
 *
 * Dentro un attributo JSX ci sono graffe, stringhe e frecce: `onChange={(e) => set(e)}` contiene
 * due `>` che non chiudono niente. Chi conta solo i caratteri si ferma lì e non vede `className`.
 * Torna `null` se il tag non si chiude (file troncato): `null` non è «tag vuoto».
 */
export function tagJsx(testo: string, inizio: number): string | null {
  let i = inizio;
  let graffe = 0;
  let apice: string | null = null;
  while (i < testo.length) {
    const c = testo[i];
    if (apice) {
      if (c === '\\') i++;
      else if (c === apice) apice = null;
    } else if (c === '"' || c === "'" || c === '`') apice = c;
    else if (c === '{') graffe++;
    else if (c === '}') graffe--;
    else if (c === '>' && graffe === 0 && testo[i - 1] !== '=') return testo.slice(inizio, i + 1);
    i++;
  }
  return null;
}

/** Le classi Tailwind che portano il testo sotto i 16px. */
export const CLASSI_PICCOLE = /\btext-(xs|sm|\[1[0-5](?:\.\d+)?px\])\b/g;

/** Toglie i commenti: un file che SPIEGA la forma malata non la commette. */
export const senzaCommenti = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

/** I tipi di `input` che non hanno testo da scrivere: lo zoom non li riguarda. */
const SENZA_TESTO = /type=["'](hidden|checkbox|radio|file|range|submit|button|image|color)["']/;

export type Campo = { file: string; riga: number; elemento: string; classi: string[] };

/** Ogni campo di testo del sito, con le classi piccole che porta addosso. */
export function campiDiTesto(file: string[]): Campo[] {
  const fuori: Campo[] = [];
  for (const f of file) {
    const t = senzaCommenti(readFileSync(f, 'utf8'));
    for (const m of t.matchAll(/<(input|textarea|select)[\s\n]/g)) {
      const tag = tagJsx(t, m.index ?? 0);
      if (!tag || SENZA_TESTO.test(tag)) continue;
      const piccole = [...tag.matchAll(CLASSI_PICCOLE)].map((x) => x[0]);
      fuori.push({
        file: relative(RADICE, f),
        riga: t.slice(0, m.index).split('\n').length,
        elemento: m[1],
        classi: piccole,
      });
    }
  }
  return fuori;
}

function sorgenti(dir: string): string[] {
  const fuori: string[] = [];
  const cammina = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) cammina(p);
      else if (/\.tsx$/.test(n) && !/\.test\.tsx?$/.test(n)) fuori.push(p);
    }
  };
  cammina(dir);
  return fuori;
}

// ─────────────────────────────────────────────────────────────────────────────
// ① Il metro sa leggere un tag vero, con le frecce dentro.
// ─────────────────────────────────────────────────────────────────────────────

describe('il metro trova la classe anche dopo una freccia', () => {
  it('la freccia di onChange non chiude il tag — è l\'errore che questo file corregge', () => {
    const src = `<input onChange={(e) => set(e.target.value)} className="text-sm" />`;
    const sbagliato = src.match(/<input[^>]*>/)?.[0] ?? '';
    expect(sbagliato.includes('className'), 'il metro vecchio si fermava sulla freccia').toBe(false);
    const giusto = tagJsx(src, 0) ?? '';
    expect(giusto.includes('className'), 'il metro nuovo arriva in fondo').toBe(true);
    expect(giusto).toMatch(CLASSI_PICCOLE);
  });

  it('le graffe annidate e le stringhe modello non lo confondono', () => {
    const src = '<input className={`base ${a > b ? "text-sm" : "text-base"}`} value={x} />';
    const tag = tagJsx(src, 0) ?? '';
    expect(tag.endsWith('/>')).toBe(true);
    expect(tag).toContain('text-sm');
  });

  it('un tag che non si chiude torna null, non una stringa vuota', () => {
    expect(tagJsx('<input className="text-sm"', 0)).toBeNull();
  });

  it('i campi senza testo da scrivere restano fuori', () => {
    const campi = campiDiTesto([]);
    expect(campi).toEqual([]);   // lista vuota in ingresso: nessuna invenzione in uscita
    expect(SENZA_TESTO.test('<input type="checkbox" className="text-sm" />')).toBe(true);
    expect(SENZA_TESTO.test('<input type="search" className="text-sm" />')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② Il pavimento c'è, ed è scritto dove serve.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = readFileSync(join(RADICE, 'app/globals.css'), 'utf8');

/**
 * Cosa copre davvero il pavimento, coppia per coppia: `input:text-sm`, `textarea:text-sm`, …
 *
 * ⚠️ PER ELEMENTO, NON PER CLASSE, E L'HA TROVATO UNA MUTAZIONE. La prima versione teneva un
 * insieme di sole classi: togliendo `input.text-sm` dal CSS il conto restava verde, perché
 * `textarea.text-sm` bastava a tenere `text-sm` dentro l'insieme. Ma sessanta dei sessantatré campi
 * piccoli sono `<input>`: il pavimento poteva sparire proprio da dove serve e nessuno lo vedeva.
 * La lista si legge da `globals.css` e non si ricopia: le due non possono divergere in silenzio.
 */
export function coperturaDelPavimento(css: string): Set<string> {
  const blocco = css.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  return new Set(
    [...blocco.matchAll(/\b(input|textarea|select)\.([\w[\]().-]+)/g)].map((m) => `${m[1]}:${m[2]}`),
  );
}

describe('il pavimento a 16px sui dispositivi a tocco', () => {
  it('esiste, e vale sui dispositivi a tocco e non su una larghezza', () => {
    expect(CSS, 'lo zoom dipende dal dispositivo, non da quanti punti è largo lo schermo')
      .toMatch(/@media\s*\(pointer:\s*coarse\)/);
  });

  it('alza a 16px e non a un numero scritto a mano', () => {
    const blocco = CSS.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(blocco, 'il pavimento non c\'è o è vuoto').not.toBe('');
    expect(blocco).toMatch(/font-size:\s*var\(--text-base\)/);
  });

  it('nomina le classi invece di prendere tutti i campi: i campi grandi non si abbassano', () => {
    const coperte = coperturaDelPavimento(CSS);
    expect(coperte.size, 'il pavimento non nomina nessuna coppia').toBeGreaterThan(0);
    for (const c of coperte)
      expect(c, 'il pavimento non deve nominare una classe grande').toMatch(/^(input|textarea|select):text-(xs|sm|\[)/);
  });

  it('copre tutt\'e tre gli elementi che si possono scrivere', () => {
    // Un pavimento su `textarea` e non su `input` sarebbe quasi inutile: sessanta dei sessantatré
    // campi piccoli sono `<input>`.
    const coperte = coperturaDelPavimento(CSS);
    for (const el of ['input', 'textarea', 'select'])
      expect([...coperte].some((c) => c.startsWith(`${el}:`)), `il pavimento non copre <${el}>`).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ L'invariante: nessun campo piccolo resta fuori dal pavimento.
// ─────────────────────────────────────────────────────────────────────────────

describe('nessun campo di testo cade fuori dal pavimento', () => {
  const campi = campiDiTesto([...sorgenti(join(RADICE, 'app')), ...sorgenti(join(RADICE, 'components'))]);

  it('ci sono campi da misurare: una lista vuota non è un verde', () => {
    // Il giorno che l'espressione smette di riconoscere i campi, questa riga diventa rossa invece
    // di lasciar passare un verde a mani vuote.
    expect(campi.length).toBeGreaterThanOrEqual(60);
  });

  it('la misura vede davvero i campi piccoli, non ne trova zero per sbaglio', () => {
    // Se questo numero andasse a zero senza che nessuno abbia riscritto 63 file, vorrebbe dire che
    // il metro ha smesso di vedere — non che il difetto è sparito.
    expect(campi.filter((c) => c.classi.length > 0).length).toBeGreaterThanOrEqual(50);
  });

  it('ogni campo piccolo è coperto dal pavimento PER IL SUO elemento', () => {
    const coperte = coperturaDelPavimento(CSS);
    const scoperto = (c: Campo) => c.classi.filter((cl) => !coperte.has(`${c.elemento}:${cl}`));
    const fuori = campi
      .filter((c) => scoperto(c).length > 0)
      .map((c) => `${c.file}:${c.riga} <${c.elemento}> → ${scoperto(c).join(', ')}`);
    expect(fuori).toEqual([]);
  });
});
