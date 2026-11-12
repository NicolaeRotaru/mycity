/**
 * R12-015 — Un nome lungo senza spazi allargava la pagina del profilo sul
 * telefono (scrollWidth 871 contro 360) e la faceva scorrere di lato. È una
 * regola di stile: la prova leggera guarda le classi dell'elemento del nome.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pagina = readFileSync(join(process.cwd(), 'app/profile/page.tsx'), 'utf8');
const elementoDelNome = pagina.match(/<p\b[^>]*>\s*\{displayName\}\s*<\/p>/)?.[0] ?? '';

describe('R12-015 il nome lungo non allarga la pagina del profilo', () => {
  it('il nome va a capo anche senza spazi', () => {
    expect(elementoDelNome).toMatch(/overflow-wrap:anywhere|break-all|break-words/);
  });
  it('si ferma a due righe e il nome intero resta leggibile nel title', () => {
    expect(elementoDelNome).toMatch(/line-clamp-2/);
    expect(elementoDelNome).toMatch(/title=\{displayName\}/);
  });
});
