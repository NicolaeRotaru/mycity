import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('R01-002 il cliente e l email dicono «fattorino», come il pulsante del negozio', () => {
  const pagina = readFileSync('app/orders/[id]/page.tsx', 'utf8');
  const email = readFileSync('lib/email/templates.ts', 'utf8');

  it('la pagina dell ordine dice fattorino nelle frasi di stato', () => {
    expect(pagina).toContain('un fattorino passa a prenderlo a breve');
    expect(pagina).toContain('Un fattorino sta arrivando in negozio');
    expect(pagina).toContain('Il fattorino ha ritirato il tuo ordine');
    expect(pagina).toContain('Il fattorino è in viaggio verso di te');
    expect(pagina).not.toMatch(/un rider passa a prenderlo/i);
    expect(pagina).not.toContain('Un rider sta arrivando in negozio');
    expect(pagina).not.toContain('Il rider ha ritirato il tuo ordine');
    expect(pagina).not.toContain('Il rider è in viaggio verso di te');
    expect(pagina).not.toContain('Il rider ne ha bisogno per chiudere la consegna');
  });

  it('l email dell ordine pronto (html e testo) dice fattorino', () => {
    expect(email.match(/un fattorino passa a prenderlo e te lo porta a casa/g)?.length).toBe(2);
    expect(email).not.toMatch(/un rider passa a prenderlo/);
  });
});
