import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guardia sulla catena di dipendenze CARICATE A RUNTIME dal sanitizzatore HTML.
 *
 * Storia (17/08/2026): il sito costruiva senza errori ma rispondeva 500 su OGNI
 * pagina in produzione su Vercel:
 *
 *   Error: require() of ES Module @exodus/bytes/encoding-lite.js
 *   from html-encoding-sniffer/lib/html-encoding-sniffer.js not supported.
 *   code: 'ERR_REQUIRE_ESM'   page: '/'
 *
 * Causa: isomorphic-dompurify@2.36 -> jsdom@28 -> html-encoding-sniffer@6, che e'
 * CommonJS ma fa require() di @exodus/bytes, pacchetto solo-ESM. lib/sanitize-html.ts
 * e' importato da HomeSectionRenderer, quindi la home lo carica a ogni richiesta.
 *
 * ⚠️ Perche' questo test e' STATICO e non prova a caricare i moduli: Node 22.12+
 * supporta require() di un modulo ESM, quindi in locale la catena rotta funziona
 * benissimo e un test che si limita a importare passerebbe. Il caricatore di moduli
 * di Vercel (/opt/rust/nodejs.js) NON lo supporta: il difetto si vede solo li'.
 * Un test "carica e vedi se esplode" avrebbe dato verde mentre la produzione era giu'.
 * Per questo si controllano i package.json risolti, non il comportamento all'import.
 *
 * NB: le dipendenze di sviluppo (es. il jsdom di vitest) non entrano nel bundle
 * serverless — non vengono tracciate da nessun import del sito — quindi restano
 * fuori da questa guardia: si parte dal modulo che il sito importa davvero.
 */

/** Punto d'ingresso reale: il pacchetto che lib/sanitize-html.ts importa. */
const ENTRY_PACKAGE = 'isomorphic-dompurify';
const ENTRY_FILE = path.resolve(process.cwd(), 'lib/sanitize-html.ts');

type Pkg = { name?: string; type?: string; dependencies?: Record<string, string> };

/**
 * Un file e' ESM? Si guarda IL FILE risolto, non l'etichetta del pacchetto.
 *
 * Distinzione che conta: `"type": "module"` nel package.json non vuol dire
 * "solo ESM". Molti pacchetti si dichiarano ESM ma spediscono anche una copia
 * CommonJS, esposta con la condizione "require" degli exports — e require.resolve()
 * prende proprio quella. Esempi veri in questo albero: tough-cookie risolve a
 * dist/index.cjs e parse5@7 a dist/cjs/index.js, entrambi CommonJS, benche' i due
 * pacchetti siano type:module. Guardare il package.json li accuserebbe a torto.
 * Rompe davvero solo chi NON ha quella copia: @exodus/bytes e parse5@8.
 */
function isEsmFile(file: string, nearest: Pkg): boolean {
  if (file.endsWith('.mjs')) return true;
  if (file.endsWith('.cjs')) return false;
  return nearest.type === 'module';
}

/** package.json del pacchetto a cui appartiene il file risolto. */
function packageJsonFor(resolved: string): { dir: string; pkg: Pkg } | null {
  let dir = path.dirname(resolved);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      return { dir, pkg: JSON.parse(fs.readFileSync(candidate, 'utf8')) as Pkg };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Percorre la catena a partire dal pacchetto d'ingresso, risolvendo ogni dipendenza
 * DAL SUO genitore (cosi' si rispettano le copie annidate in node_modules e gli
 * override). Ritorna gli archi "genitore CommonJS -> figlio solo-ESM".
 *
 * Solo quell'accoppiata rompe: e' un require() da CommonJS verso un modulo ESM.
 * Un pacchetto ESM figlio di un altro ESM usa import() e non da' problemi, quindi
 * non va segnalato — altrimenti la guardia urlerebbe su mezza catena di jsdom.
 */
function cjsRequiresEsmEdges(): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();

  const entry = createRequire(ENTRY_FILE).resolve(ENTRY_PACKAGE);
  const queue: Array<{ from: string; trail: string[] }> = [
    { from: entry, trail: [ENTRY_PACKAGE] },
  ];

  while (queue.length) {
    const { from, trail } = queue.shift()!;
    const info = packageJsonFor(from);
    if (!info) continue;
    if (seen.has(info.dir)) continue;
    seen.add(info.dir);

    const parentIsCjs = !isEsmFile(from, info.pkg);

    for (const dep of Object.keys(info.pkg.dependencies ?? {})) {
      let resolved: string;
      try {
        resolved = createRequire(path.join(info.dir, 'package.json')).resolve(dep);
      } catch {
        // Sotto-percorso di export non risolvibile dalla radice, o dipendenza
        // opzionale assente: non fa parte della catena caricabile. Si salta.
        continue;
      }
      const child = packageJsonFor(resolved);
      if (parentIsCjs && child && isEsmFile(resolved, child.pkg)) {
        bad.push(`${trail.join(' -> ')} (CommonJS) -> ${dep} (solo ESM)`);
      }
      queue.push({ from: resolved, trail: [...trail, dep] });
    }
  }

  return bad;
}

describe('catena di dipendenze caricata a runtime', () => {
  it(`il pacchetto d'ingresso ${ENTRY_PACKAGE} e' risolvibile da lib/sanitize-html.ts`, () => {
    expect(() => createRequire(ENTRY_FILE).resolve(ENTRY_PACKAGE)).not.toThrow();
  });

  it('html-encoding-sniffer risolto nella catena e\' CommonJS e non usa @exodus/bytes', () => {
    const idp = createRequire(ENTRY_FILE).resolve(ENTRY_PACKAGE);
    const jsdom = createRequire(idp).resolve('jsdom');
    const sniffer = createRequire(jsdom).resolve('html-encoding-sniffer');
    const info = packageJsonFor(sniffer);

    expect(info, 'package.json di html-encoding-sniffer non trovato').not.toBeNull();
    expect(info!.pkg.type ?? 'commonjs', 'html-encoding-sniffer deve restare CommonJS').toBe('commonjs');
    expect(
      Object.keys(info!.pkg.dependencies ?? {}),
      'html-encoding-sniffer non deve dipendere da @exodus/bytes (solo-ESM): romperebbe la produzione con ERR_REQUIRE_ESM',
    ).not.toContain('@exodus/bytes');
  });

  it('nessun pacchetto CommonJS che richiama un pacchetto solo-ESM', () => {
    const edges = cjsRequiresEsmEdges();
    expect(
      edges,
      `require() da CommonJS verso ESM (ERR_REQUIRE_ESM in produzione): ${edges.join(' | ')}`,
    ).toEqual([]);
  });
});
