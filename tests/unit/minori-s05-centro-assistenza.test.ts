import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S05 · schede 362 e 347 — il Centro assistenza.
 * Lettura dei sorgenti: la FAQ è una pagina con metadati di Next, il link e
 * l'id devono combaciare.
 */

const help = readFileSync('app/help/page.tsx', 'utf8');
const faq = readFileSync('app/faq/page.tsx', 'utf8');

describe('Centro assistenza', () => {
  it('362: ogni «/faq#…» del Centro assistenza ha la sua sezione con quell’id', () => {
    const ancore = [...help.matchAll(/'\/faq#([a-z-]+)'/g)].map((m) => m[1]);
    expect(ancore.length).toBeGreaterThan(0);
    for (const a of ancore) expect(faq, `manca la sezione con id «${a}»`).toContain(`id: '${a}'`);
    expect(faq).toMatch(/<section key=\{section\.title\} id=\{section\.id\}/);
  });

  it('347: non promette «più di 25 risposte»', () => {
    expect(help).not.toMatch(/Più di \d+ risposte/);
  });
});
