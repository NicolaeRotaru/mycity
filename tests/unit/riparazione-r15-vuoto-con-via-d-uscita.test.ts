/**
 * R15-019 — Novità, Più recensiti e Regali, vuoti, dicevano «Prova a modificare i filtri» senza filtri e
 * senza una strada per uscire. Prova leggera: le tre pagine danno alla griglia parole loro e un link.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (f: string) => readFileSync(join(process.cwd(), ...f.split('/')), 'utf8');

describe.each([
  ['app/novita/page.tsx'],
  ['app/piu-venduti/page.tsx'],
  ['app/regali/RegaliClient.tsx'],
])('R15-019 stato vuoto di %s', (file) => {
  const src = leggi(file);
  it('ha titolo e descrizione propri e un link per uscire', () => {
    expect(src).toMatch(/emptyTitle=/);
    expect(src).toMatch(/emptyDescription=/);
    expect(src).toMatch(/emptySuggestions=\{[\s\S]*<Link href="\/search"/);
    expect(src).toMatch(/href="\/categorie"/);
  });
  it('non parla di filtri che non ci sono', () => {
    const vuoto = src.slice(src.indexOf('emptyTitle='));
    expect(vuoto).not.toMatch(/modificare i filtri/i);
  });
});
