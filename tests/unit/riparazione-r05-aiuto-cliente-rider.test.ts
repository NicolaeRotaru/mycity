import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const help = readFileSync('app/help/page.tsx', 'utf8');

describe('Centro assistenza: chi ha già un account cliente ha una strada verso la candidatura rider', () => {
  it('la scheda «Diventa rider» porta alla pagina di candidatura, che esiste', () => {
    expect(existsSync('app/lavora-con-noi/page.tsx')).toBe(true);
    const scheda = help.match(/title: 'Diventa rider'[\s\S]*?href: '([^']+)'/);
    expect(scheda?.[1]).toBe('/lavora-con-noi');
  });

  it('una riga dice al cliente già registrato come fare, col modulo contatti', () => {
    expect(help).toMatch(/Hai già un account cliente/);
    expect(help).toMatch(/href="\/contact"[^>]*>Scrivici dal modulo contatti/);
  });
});
