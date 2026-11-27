// L'analisi di SDG è un documento interno: la legge solo la rotta del server (collaudo del 27/11/2026).
// Nessun file del browser può importare il registro del lavoro consegnato o i JSON dei negozi: se un domani
// un componente li importa, il loro contenuto finisce nel pacchetto che scarica ogni visitatore.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RADICE = path.resolve(__dirname, '../..');
const PROIBITI = /from\s+['"][^'"]*lavoro-consegnato\/(registro|[a-z0-9-]+\/[a-z0-9-]+\.json)['"]/;

function file(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === 'node_modules' || n.startsWith('.')) return [];
    return statSync(p).isDirectory() ? file(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}

describe('il lavoro consegnato resta sul server', () => {
  const tutti = ['app', 'components', 'lib'].flatMap((d) => file(path.join(RADICE, d)));

  it('nessun file del browser importa il registro o i JSON del lavoro consegnato', () => {
    const colpevoli = tutti.filter((p) => {
      const t = readFileSync(p, 'utf8');
      const delBrowser = /^\s*['"]use client['"]/m.test(t) || p.includes(`${path.sep}components${path.sep}`);
      return delBrowser && PROIBITI.test(t);
    });
    expect(colpevoli.map((p) => path.relative(RADICE, p))).toEqual([]);
  });

  it('il registro lo importa la rotta del server', () => {
    const rotta = readFileSync(path.join(RADICE, 'app/api/seller/lavoro-consegnato/route.ts'), 'utf8');
    expect(rotta).toMatch(PROIBITI);
  });

  it('la regola scatta davvero su un import proibito', () => {
    expect(PROIBITI.test("import { lavoroConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';")).toBe(true);
    expect(PROIBITI.test("import analisi from '@/lib/agenzia/lavoro-consegnato/sdg/analisi.json';")).toBe(true);
    expect(PROIBITI.test("import type { LavoroConsegnato } from '@/lib/agenzia/lavoro-consegnato/tipi';")).toBe(false);
  });
});
