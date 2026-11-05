import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('components/cart/CartUpsell.tsx', 'utf8');

describe('S07 · «Completa con» nel carrello', () => {
  it('il «+» è grande quanto gli altri pulsanti del carrello (44 px, h-11 w-11)', () => {
    const bottone = src.slice(src.indexOf('onClick={() => handleAdd(p)}'), src.indexOf('<Plus'));
    expect(bottone).toMatch(/h-11 w-11/);
    expect(bottone).not.toMatch(/h-8 w-8/);
  });
  it('mostra e salva il prezzo con la promozione, letta con la funzione della cassa', () => {
    const lettura = src.slice(src.indexOf('queryFn'), src.indexOf('if (suggestions.length === 0)'));
    expect(lettura).toMatch(/fetchActiveDiscounts\(supabase/);
    expect(lettura).toMatch(/discountedUnitCents\(p\.price/);
  });
});
