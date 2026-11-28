import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * R10-014 / R10-002 (onda 2, 28/11/2026) — LA SCALA DEL TESTO SCAVALCATA CON MISURE A MANO.
 *
 * La scala è in app/globals.css (--text-2xs … --text-6xl: 10, 12, 14, 16, 18, 20, 24, 30, 36, 48,
 * 60 px) e in Tailwind (`text-2xs` in tailwind.config.ts, gli altri di serie). In onda 1 si erano
 * sistemati solo i file della sessione: in tutto il sito restavano 39 misure a mano che
 * coincidono con un gradino (25 × 10 px, 4 × 12, 5 × 14, 3 × 18, 2 × 24, 1 × 30). Portate sul
 * gradino: 10 → text-2xs, 12 → text-xs, 14 → text-sm, 18 → text-lg, 24 → text-2xl, 30 → text-3xl.
 *
 * Restano le misure SENZA gradino (11, 13, 15, 17, 22, 26, 32 px e poche altre): quale gradino
 * usare lo sceglie Nicola. Questa prova scorre tutti i .tsx di app/ e components/ e ferma solo
 * le misure a mano che hanno un gradino esatto (anche in rem).
 */
const RADICE = process.cwd();
const GRADINI_PX = new Set([10, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60]);
const MISURA_A_MANO = /text-\[(\d+(?:\.\d+)?)(px|rem)\]/g;
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function tsx(cartella: string): string[] {
  const fuori: string[] = [];
  for (const nome of readdirSync(cartella)) {
    const p = join(cartella, nome);
    if (statSync(p).isDirectory()) fuori.push(...tsx(p));
    else if (p.endsWith('.tsx')) fuori.push(p);
  }
  return fuori;
}

const inPx = (n: number, unita: string) => (unita === 'rem' ? n * 16 : n);

describe('R10-014 / R10-002 · niente text-[N] a mano dove la scala ha il gradino', () => {
  const file = [...tsx(join(RADICE, 'app')), ...tsx(join(RADICE, 'components'))];

  it('IL CASO DELLA VOCE — nessun .tsx di app/ e components/ scrive a mano un gradino della scala', () => {
    const aggirati: string[] = [];
    for (const f of file) {
      const src = senzaCommenti(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(MISURA_A_MANO)) {
        if (GRADINI_PX.has(inPx(Number(m[1]), m[2]))) aggirati.push(`${relative(RADICE, f)} ${m[0]}`);
      }
    }
    expect(aggirati, 'misure a mano che hanno il loro gradino nella scala').toEqual([]);
  });

  it('il gradino da 10 px esiste, in Tailwind e nei token', () => {
    expect(readFileSync(join(RADICE, 'tailwind.config.ts'), 'utf8')).toMatch(/'2xs':\s*'0\.625rem'/);
    expect(readFileSync(join(RADICE, 'app/globals.css'), 'utf8')).toMatch(/--text-2xs:\s*0\.625rem/);
  });

  it('la regola riconosce un gradino anche in rem, e lascia stare le misure senza gradino', () => {
    const trova = (s: string) => [...s.matchAll(MISURA_A_MANO)].filter((m) => GRADINI_PX.has(inPx(Number(m[1]), m[2]))).map((m) => m[0]);
    expect(trova('text-[0.75rem] sm:text-[14px]')).toEqual(['text-[0.75rem]', 'text-[14px]']);
    expect(trova('text-[11px] text-[13px] text-[2rem]')).toEqual([]);
  });
});
