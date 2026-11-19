import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'components/cart/CartUpsell.tsx'), 'utf8');

// R08-006: un prezzo da 5000 € in su nel «completa con» si tronca; il pulsante «+» non si stringe.
describe('R08-006 prezzo lungo nel «completa con»', () => {
  it('il prezzo può restringersi e troncarsi', () => {
    const riga = src.split('\n').find((l) => l.includes('formatPrice(p.price)'))!;
    expect(riga).toMatch(/min-w-0/);
    expect(riga).toMatch(/truncate/);
  });
  it('il pulsante «+» non si stringe mai', () => {
    const i = src.indexOf('aria-label={`Aggiungi');
    const blocco = src.slice(i, i + 400);
    expect(blocco).toMatch(/shrink-0/);
  });
});
