import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/checkout/page.tsx', 'utf8');

describe('R19-003 · l\'avviso «fuori zona» sta anche accanto all\'indirizzo', () => {
  it('nel passo 1, subito dopo il modulo indirizzo, c\'è l\'avviso con la stessa frase del blocco', () => {
    const a = src.indexOf('<ShippingAddressForm');
    const b = src.indexOf('title="Quando vuoi riceverlo"');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    const passo1 = src.slice(a, b);
    expect(passo1).toMatch(/\{fuoriZona && \(/);
    expect(passo1).toMatch(/role="alert"/);
    expect(passo1).toMatch(/motivoFuoriZona\(gruppoFuoriZona\?\.storeName\)/);
  });
});
