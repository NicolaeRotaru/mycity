/**
 * R17-006 — /come-funziona col testo al 200%: la riga icona + titolo della banda di rassicurazione
 * non deve far scorrere la pagina di lato.
 * Prova leggera sulle classi del file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sorgente = readFileSync(join(process.cwd(), 'app', 'come-funziona', 'page.tsx'), 'utf8');

describe('R17-006 riga icona + titolo della banda', () => {
  it('riga, icona e h2 non fanno scorrere la pagina', () => {
    const i = sorgente.indexOf('{REASSURANCE.map');
    const banda = sorgente.slice(i, sorgente.indexOf('</section>', i));
    expect(banda).toMatch(/<div className="mb-2 flex min-w-0 items-center/);
    expect(banda).toMatch(/<span className="flex h-10 w-10 shrink-0 /);
    const h2 = banda.match(/<h2 [^>]*>/)?.[0] ?? '';
    expect(h2).toMatch(/\bmin-w-0\b/);
    expect(h2).toMatch(/\bbreak-words\b/);
  });
});
