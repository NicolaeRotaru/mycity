import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/checkout/page.tsx', 'utf8');

describe('R19-014 · carrello non letto: stato d\'errore con «Riprova», senza cifre', () => {
  it('il riquadro d\'errore ha il pulsante «Riprova» che rilegge la cassa', () => {
    const i = src.indexOf('Non riesco a leggere il carrello.</strong>');
    expect(i).toBeGreaterThan(0);
    const blocco = src.slice(i, i + 500);
    expect(blocco).toMatch(/onClick=\{\(\) => void rileggiLaCassa\(\)\}[^>]*>Riprova</);
  });
  it('la riga «Consegna a domicilio» non scrive «Gratis» se i gruppi non sono letti', () => {
    expect(src).toMatch(/groups\.length === 0 \? '—' : consegnaDaPagare === 0/);
  });
});
