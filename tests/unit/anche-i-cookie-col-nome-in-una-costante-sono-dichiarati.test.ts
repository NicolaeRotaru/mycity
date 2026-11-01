import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 1/11/2026 — Il guardiano `ogni-cookie-e-dichiarato` legge solo i nomi scritti
 * tra virgolette dentro `cookies.set(...)`. Un cookie col nome in una costante
 * (`cookies.set({ name: BISCOTTO_RECUPERO, … })`) gli sfuggiva: è successo col
 * segno del recupero della password. Qui si risolvono anche le costanti, cercando
 * `const NOME = '…'` in tutti i sorgenti, e si pretende la riga in /cookies.
 */
const RADICE = join(__dirname, '..', '..');
const POLICY = join(RADICE, 'app', 'cookies', 'page.tsx');
const NON_NOSTRI = new Set(['__cf_bm', '__stripe_mid', '__stripe_sid']);

function sorgenti(dir: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) sorgenti(percorso, dentro);
    else if (/\.(ts|tsx)$/.test(voce)) dentro.push(percorso);
  }
  return dentro;
}

export function nomiDeiCookieDaCostanti(testi: Map<string, string>): Map<string, string> {
  const costanti = new Map<string, string>();
  for (const testo of testi.values()) {
    for (const m of testo.matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*['"`]([^'"`$]+)['"`]/g)) {
      costanti.set(m[1], m[2]);
    }
  }
  const trovati = new Map<string, string>();
  for (const [file, testo] of testi) {
    const usi = [
      ...testo.matchAll(/cookies\.set\(\s*\{\s*name:\s*([A-Z_][A-Z0-9_]*)\b/g),
      ...testo.matchAll(/cookies\.set\(\s*([A-Z_][A-Z0-9_]*)\s*,/g),
    ];
    for (const m of usi) {
      const nome = costanti.get(m[1]);
      if (nome) trovati.set(nome, file);
    }
  }
  return trovati;
}

describe('anche i cookie col nome in una costante sono dichiarati', () => {
  it('il lettore delle costanti trova il nome vero', () => {
    const testi = new Map([
      ['a.ts', "export const BISCOTTO_X = 'mio_biscotto';"],
      ['b.ts', 'r.cookies.set({ name: BISCOTTO_X, value: v });\nr.cookies.set(BISCOTTO_X, v);'],
    ]);
    expect([...nomiDeiCookieDaCostanti(testi).keys()]).toEqual(['mio_biscotto']);
  });

  it('nessun cookie col nome in una costante manca dalla pagina /cookies', () => {
    const policy = readFileSync(POLICY, 'utf8');
    const file = [...['app', 'lib', 'components'].flatMap((c) => sorgenti(join(RADICE, c))), join(RADICE, 'middleware.ts')];
    const testi = new Map(file.map((f) => [relative(RADICE, f), readFileSync(f, 'utf8')] as const));
    const mancanti: string[] = [];
    for (const [nome, dove] of nomiDeiCookieDaCostanti(testi)) {
      if (NON_NOSTRI.has(nome) || nome.startsWith('sb-')) continue;
      if (!policy.includes(nome)) mancanti.push(`${nome}  (impostato in ${dove})`);
    }
    expect(mancanti, 'Cookie col nome in una costante, non dichiarati in app/cookies/page.tsx:\n  ' + mancanti.join('\n  ')).toEqual([]);
  });
});
