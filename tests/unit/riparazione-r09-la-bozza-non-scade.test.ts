import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const pagina = readFileSync('app/checkout/page.tsx', 'utf8');
const provaDellaBozza = readFileSync('tests/unit/riparazione-r19-ho-gia-un-account-salva-la-bozza.test.ts', 'utf8');
const bozza = readFileSync('lib/bozza-checkout.ts', 'utf8');

describe('la bozza della cassa non ha una scadenza, e nessun testo dice il contrario', () => {
  it('il codice della bozza non conosce scadenze', () => {
    expect(bozza).not.toMatch(/scad|expire|ttl/i);
  });
  it('il commento sopra il salvataggio dice che non scade', () => {
    const i = pagina.indexOf('const salvaLaBozzaPerAccesso');
    expect(i).toBeGreaterThan(0);
    const sopra = pagina.slice(Math.max(0, i - 600), i);
    expect(sopra).not.toMatch(/con la scadenza|scade dopo|scade tra/i);
    expect(sopra).toMatch(/non ha una scadenza/);
  });
  it('il titolo della prova sul salvataggio non promette una scadenza', () => {
    expect(provaDellaBozza).not.toMatch(/\(con la scadenza\)/);
  });
});
