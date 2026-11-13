/**
 * R15-017 — il commento sui `categoryIds` diceva solo «i regali hanno risolto da sé»: oggi l'elenco lo
 * passano due pagine, per due motivi opposti. Prova leggera: il commento li nomina entrambi.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('R15-017 commento sui categoryIds', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'queries', 'griglia-prodotti.ts'), 'utf8');
  const i = src.indexOf('Le categorie da leggere, risolte UNA volta');
  const commento = src.slice(i, src.indexOf('*/', i));

  it('dice che categoryIds non allarga alle figlie e nomina Regali e «Altri prodotti»', () => {
    expect(i).toBeGreaterThan(-1);
    expect(commento).toContain('categoryIds');
    expect(commento).toMatch(/NON allarga alle figlie/);
    expect(commento).toMatch(/Regali/);
    expect(commento).toMatch(/Altri prodotti/);
  });
});
