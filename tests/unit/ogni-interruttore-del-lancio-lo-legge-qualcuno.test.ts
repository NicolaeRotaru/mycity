import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import * as interruttori from '@/lib/funzioni-al-lancio';

/**
 * 27/10/2026 — UN INTERRUTTORE CHE NESSUNO LEGGE DICHIARA IL FALSO.
 *
 * lib/funzioni-al-lancio.ts è la casa delle funzioni spente al lancio (carta
 * #209, firmata da Nicola il 26/10). Il riesame ha trovato due voci che nessun
 * file leggeva: APP_INSTALLABILE_ACCESA e CODICI_SCONTO_IN_CASSA. Il file
 * diceva «spento», ma cambiare quel `false` non spegneva e non accendeva
 * niente: il banner dell'app restava acceso, la cassa accettava i codici.
 * Chi legge il file si fida di una cosa che non succede.
 *
 * Questa prova diventa rossa se il file esporta un interruttore che nessun
 * file di app/, components/ o lib/ importa E usa. Le prove (tests/) non
 * contano: leggere un interruttore per controllarlo non è spegnere niente.
 *
 * Sbaglia solo verso il rosso: un import di soli tipi, un `export … from`, un
 * `import()` dinamico o un `import * as` passato intero non li riconosce come
 * lettura. In quel caso la prova boccia anche se l'interruttore è letto, e va
 * insegnata la forma nuova qui sotto (con la sua prova nel secondo blocco).
 *
 * QUELLO CHE NON PUÒ FARE: vede che l'interruttore è letto, non che è letto
 * BENE (dalla pagina e dalla rotta). Quello lo provano
 * le-funzioni-spente-al-lancio-non-si-vedono e …-le-rifiuta-il-server.
 */

const RADICE = process.cwd();
const CASA = join(RADICE, 'lib', 'funzioni-al-lancio');
const CARTELLE = ['app', 'components', 'lib'];
const SORGENTE = /\.(ts|tsx|js|jsx|mjs)$/;

function fileSotto(cartella: string): string[] {
  const fuori: string[] = [];
  for (const voce of readdirSync(cartella, { withFileTypes: true })) {
    if (voce.name === 'node_modules' || voce.name.startsWith('.')) continue;
    const pieno = join(cartella, voce.name);
    if (voce.isDirectory()) fuori.push(...fileSotto(pieno));
    else if (SORGENTE.test(voce.name)) fuori.push(pieno);
  }
  return fuori;
}

/** Il modulo importato è la casa degli interruttori? Vale per `@/lib/…` e per i percorsi relativi. */
function puntaAllaCasa(modulo: string, daFile: string): boolean {
  let assoluto: string;
  if (modulo.startsWith('@/')) assoluto = join(RADICE, modulo.slice(2));
  else if (modulo.startsWith('.')) assoluto = resolve(dirname(daFile), modulo);
  else return false;
  return assoluto.replace(/\.(ts|js)$/, '') === CASA;
}

/**
 * Quali interruttori legge un file: un import con nome (anche rinominato) che
 * il file usa almeno una volta, oppure `ns.NOME` / `ns['NOME']` su un
 * `import * as ns`. Un import di soli tipi non legge il valore e non conta.
 */
function interruttoriLetti(testo: string, file: string): Set<string> {
  const letti = new Set<string>();
  const sorgente = ts.createSourceFile(
    file, testo, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const locali = new Map<string, string>();
  const spazi = new Set<string>();

  for (const istruzione of sorgente.statements) {
    if (!ts.isImportDeclaration(istruzione) || !ts.isStringLiteral(istruzione.moduleSpecifier)) continue;
    if (!puntaAllaCasa(istruzione.moduleSpecifier.text, file)) continue;
    const clausola = istruzione.importClause;
    if (!clausola || clausola.isTypeOnly || !clausola.namedBindings) continue;
    if (ts.isNamespaceImport(clausola.namedBindings)) {
      spazi.add(clausola.namedBindings.name.text);
      continue;
    }
    for (const el of clausola.namedBindings.elements) {
      if (!el.isTypeOnly) locali.set(el.name.text, (el.propertyName ?? el.name).text);
    }
  }
  if (locali.size === 0 && spazi.size === 0) return letti;

  const visita = (nodo: ts.Node): void => {
    if (ts.isImportDeclaration(nodo)) return;
    if (ts.isPropertyAccessExpression(nodo) && ts.isIdentifier(nodo.expression) && spazi.has(nodo.expression.text)) {
      letti.add(nodo.name.text);
    } else if (
      ts.isElementAccessExpression(nodo) && ts.isIdentifier(nodo.expression) && spazi.has(nodo.expression.text)
      && ts.isStringLiteralLike(nodo.argumentExpression)
    ) {
      letti.add(nodo.argumentExpression.text);
    } else if (ts.isIdentifier(nodo) && locali.has(nodo.text)) {
      const padre = nodo.parent;
      const eUnNomeDiProprieta =
        (ts.isPropertyAccessExpression(padre) && padre.name === nodo)
        || (ts.isPropertyAssignment(padre) && padre.name === nodo);
      if (!eUnNomeDiProprieta) letti.add(locali.get(nodo.text)!);
    }
    ts.forEachChild(nodo, visita);
  };
  visita(sorgente);
  return letti;
}

/** Per ogni interruttore, i file del sito che lo leggono. */
function chiLegge(): Map<string, string[]> {
  const lettori = new Map<string, string[]>();
  for (const cartella of CARTELLE) {
    for (const file of fileSotto(join(RADICE, cartella))) {
      if (file.replace(SORGENTE, '') === CASA) continue;
      const testo = readFileSync(file, 'utf8');
      if (!testo.includes('funzioni-al-lancio')) continue;
      for (const nome of interruttoriLetti(testo, file)) {
        lettori.set(nome, [...(lettori.get(nome) ?? []), relative(RADICE, file)]);
      }
    }
  }
  return lettori;
}

describe('ogni interruttore del lancio lo legge qualcuno', () => {
  it('nessun interruttore esportato resta senza un file che lo importa e lo usa', () => {
    const esportati = Object.keys(interruttori);
    expect(esportati.length, 'controprova: il file degli interruttori deve esportare qualcosa').toBeGreaterThan(0);
    const lettori = chiLegge();
    const orfani = esportati.filter((nome) => !lettori.has(nome));
    expect(
      orfani,
      'questi interruttori dicono «spento» ma nessun file di app/, components/ o lib/ li legge: '
        + 'o li legge la pagina e la rotta, o si tolgono dal file con una nota vera',
    ).toEqual([]);
  }, 30000);

  it('controprova sul codice vero: trova i lettori che ci sono (anche col percorso relativo)', () => {
    const lettori = chiLegge();
    expect(lettori.get('BUONI_REGALO_IN_VENDITA')).toContain(join('app', 'api', 'gift-cards', 'checkout', 'route.ts'));
    expect(lettori.get('DROP_DEL_GIORNO_ACCESO')).toContain(join('lib', 'home-site.ts'));
    expect(lettori.get('NEWSLETTER_ACCESA')).toContain(join('lib', 'home-site.ts'));
  }, 30000);
});

describe('il lettore degli import riconosce le forme giuste e solo quelle', () => {
  const PAGINA = join(RADICE, 'app', 'prova', 'page.tsx');
  const letti = (testo: string, file = PAGINA) => [...interruttoriLetti(testo, file)].sort();

  it('import con nome usato, anche rinominato: letto', () => {
    expect(letti(`import { A_ACCESA, B_ACCESA as b } from '@/lib/funzioni-al-lancio';\nif (A_ACCESA || b) {}`))
      .toEqual(['A_ACCESA', 'B_ACCESA']);
  });

  it('percorso relativo dalla stessa cartella: letto', () => {
    expect(letti(`import { A_ACCESA } from './funzioni-al-lancio';\nexport const x = A_ACCESA;`, join(RADICE, 'lib', 'x.ts')))
      .toEqual(['A_ACCESA']);
  });

  it('import * as: conta solo il nome che si legge davvero', () => {
    expect(letti(`import * as f from '@/lib/funzioni-al-lancio';\nconst x = f.A_ACCESA && f['B_ACCESA'];`))
      .toEqual(['A_ACCESA', 'B_ACCESA']);
  });

  it('import con nome mai usato: NON letto', () => {
    expect(letti(`import { A_ACCESA } from '@/lib/funzioni-al-lancio';\nconst y = { A_ACCESA: 1 }.A_ACCESA;`)).toEqual([]);
  });

  it('import di soli tipi: NON letto', () => {
    expect(letti(`import type { A_ACCESA } from '@/lib/funzioni-al-lancio';\ntype T = typeof A_ACCESA;`)).toEqual([]);
  });

  it('lo stesso nome da un altro modulo: NON letto', () => {
    expect(letti(`import { A_ACCESA } from '@/lib/altro';\nif (A_ACCESA) {}`)).toEqual([]);
  });
});
