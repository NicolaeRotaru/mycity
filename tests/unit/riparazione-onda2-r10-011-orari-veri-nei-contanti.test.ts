import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R10-011 (onda 2, 28/11/2026) — UNA PROVA DEI CONTANTI SOSTITUIVA TUTTI GLI ORARI CON «PUÒ SEMPRE SERVIRE».
 *
 * tests/unit/contanti-la-chiave-si-prende-prima.test.ts percorre la rotta vera dei contanti fino in
 * fondo, ma rimpiazzava '@/lib/store-hours' con un finto che diceva sì a ogni negozio e ogni fascia:
 * la regola degli orari poteva rompersi senza che la prova se ne accorgesse. Adesso gira la regola
 * vera, e un caso col forno chiuso per ferie si aspetta il 409. Questa prova legge il file: il finto
 * non torna, e il caso del negozio chiuso resta.
 */
const PROVA = join(process.cwd(), 'tests/unit/contanti-la-chiave-si-prende-prima.test.ts');
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('R10-011 · la prova dei contanti usa gli orari veri', () => {
  const codice = senzaCommenti(readFileSync(PROVA, 'utf8'));

  it('IL CASO DELLA VOCE — nessun finto di @/lib/store-hours', () => {
    expect(codice).not.toMatch(/vi\.mock\(\s*['"]@\/lib\/store-hours['"]/);
    expect(codice).not.toMatch(/negozioPuoServire:\s*vi\.fn\(\s*\(\)\s*=>\s*true\s*\)/);
  });

  it('e c’è il caso del negozio chiuso, che la rotta deve rifiutare', () => {
    expect(codice).toMatch(/toBe\(409\)/);
  });
});
