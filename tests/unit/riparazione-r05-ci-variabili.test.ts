import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function leggiTutti(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'riparazione-r05-ci-variabili.test.ts') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) leggiTutti(p, acc);
    else if (/\.(ts|tsx|mjs|js|json)$/.test(n)) acc.push(readFileSync(p, 'utf8'));
  }
  return acc;
}

describe('ci.yml: le variabili del passo Test sono lette dal codice', () => {
  it('ogni variabile impostata nel passo Test compare nei file di prova o negli script', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const passo = ci.split(/\n\s*- name: Test\n/)[1]?.split(/\n\s*- name:|\n\s{2}\w[\w-]*:\n/)[0] ?? '';
    const env = passo.match(/env:\n((?:\s+[^\n]*\n?)*?)\s+run:/)?.[1] ?? '';
    const nomi = [...env.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
    const codice = [...leggiTutti(join(ROOT, 'tests')), ...leggiTutti(join(ROOT, 'scripts'))].join('\n');
    for (const nome of nomi) expect(codice, `${nome} non e' letta da nessuno`).toContain(nome);
    expect(ci).not.toContain('PROVE_POSTGRES_OBBLIGATORIE');
  });
});
