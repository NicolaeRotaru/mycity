import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

/**
 * R23-004 (13/11/2026) — DUE FILE IMPORTAVANO UNA LIBRERIA CHE NON È INSTALLATA.
 *
 * `lib/health/checks.ts` e `lib/products/externalSync.ts` aprivano con `import 'server-only'`.
 * Quella libreria non è fra le dipendenze di package.json né in node_modules: reggeva solo
 * perché Next, quando costruisce, la sostituisce con una copia sua interna. Nelle prove andava
 * finta a mano, e il giorno che Next cambia quella scorciatoia il sito non si costruisce più.
 *
 * Qui si leggono gli import veri dei due file (commenti esclusi) e ogni libreria esterna deve
 * essere dichiarata in package.json E installata.
 */

const FILE = ['lib/health/checks.ts', 'lib/products/externalSync.ts'];

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const DICHIARATE = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
const DI_NODE = new Set(builtinModules);

function senzaCommenti(testo: string): string {
  return testo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** I nomi delle librerie esterne che il file importa (statici, di solo effetto e dinamici). */
function librerieImportate(testo: string): string[] {
  const nomi = new Set<string>();
  // Solo le forme vere di import/export (a inizio riga) e l'import dinamico con un nome fisso:
  // un «from "» dentro il testo di un prompt non è un import.
  const forme = [
    /^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"\s]+)['"]/gm,
    /^\s*import\s*['"]([^'"\s]+)['"]/gm,
    /\bimport\(\s*['"]([^'"\s]+)['"]\s*\)/g,
  ];
  for (const forma of forme) {
    for (const m of senzaCommenti(testo).matchAll(forma)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('node:') || DI_NODE.has(spec)) continue;
      const pezzi = spec.split('/');
      nomi.add(spec.startsWith('@') ? pezzi.slice(0, 2).join('/') : pezzi[0]);
    }
  }
  return [...nomi].sort();
}

describe('ogni libreria importata è dichiarata e installata', () => {
  for (const file of FILE) {
    it(`${file}: niente librerie che reggono per una scorciatoia di Next`, () => {
      const importate = librerieImportate(readFileSync(file, 'utf8'));
      expect(importate.length, 'la lettura degli import non ha trovato niente: la prova guarda il vuoto').toBeGreaterThan(0);
      const nonDichiarate = importate.filter((n) => !DICHIARATE.has(n));
      const nonInstallate = importate.filter((n) => !existsSync(join('node_modules', n, 'package.json')));
      expect(nonDichiarate, 'importate ma non dichiarate in package.json').toEqual([]);
      expect(nonInstallate, 'importate ma assenti da node_modules').toEqual([]);
    });
  }
});
