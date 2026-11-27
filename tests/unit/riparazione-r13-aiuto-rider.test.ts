import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R13-010 — La scheda «Diventa rider» della pagina di aiuto prometteva a tutti «Ti candidi dal sito»: per un cliente
// già registrato quella strada non c'è (/sign-up?role=rider non riconosce l'account). La scheda ora dice che la
// candidatura dal sito è per chi è nuovo e manda il cliente già registrato al paragrafo che gli spiega la sua strada.
const help = readFileSync('app/help/page.tsx', 'utf8');
const scheda = help.match(/title: 'Diventa rider',\s*desc: '([^']+)'/)?.[1] ?? '';

describe('R13-010 — la scheda «Diventa rider» non promette la candidatura dal sito a chi è già cliente', () => {
  it('la candidatura dal sito è detta solo per chi è nuovo', () => {
    expect(scheda).toMatch(/Nuovo su MyCity\? Ti candidi dal sito\./);
    expect(scheda).not.toMatch(/città\. Ti candidi dal sito\.$/);
  });
  it('il cliente già registrato è mandato al paragrafo sotto, che esiste', () => {
    expect(scheda).toMatch(/Hai già un account cliente\? Leggi qui sotto\./);
    expect(help).toMatch(/id="gia-cliente-rider"/);
  });
});
