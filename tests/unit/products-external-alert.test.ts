import { describe, it, expect } from 'vitest';
import { detectExternalChange, changeMessage } from '@/lib/products/externalAlert';
import type { Availability } from '@/lib/products/externalSyncShared';

const prev = (price: number | null, availability: Availability) => ({ price, availability });

describe('detectExternalChange', () => {
  it('prezzo su del 10% → cambiamento', () => {
    const d = detectExternalChange(prev(20, 'in_stock'), { price: 22, availability: 'in_stock' });
    expect(d).not.toBeNull();
    expect(d!.priceChanged).toBe(true);
    expect(d!.pricePct).toBeCloseTo(0.1, 5);
  });

  it('variazione sotto soglia (0.5%) e disponibilità invariata → null', () => {
    const d = detectExternalChange(prev(20, 'in_stock'), { price: 20.1, availability: 'in_stock' });
    expect(d).toBeNull();
  });

  it('passaggio a esaurito → cambiamento disponibilità', () => {
    const d = detectExternalChange(prev(20, 'in_stock'), { price: 20, availability: 'out_of_stock' });
    expect(d).not.toBeNull();
    expect(d!.availabilityChanged).toBe(true);
    expect(d!.priceChanged).toBe(false);
  });

  it('nuovo stato unknown → non conta come cambiamento', () => {
    const d = detectExternalChange(prev(20, 'in_stock'), { price: 20, availability: 'unknown' });
    expect(d).toBeNull();
  });

  it('prezzi non confrontabili (uno nullo) → nessun cambio prezzo', () => {
    const d = detectExternalChange(prev(null, 'in_stock'), { price: 30, availability: 'in_stock' });
    expect(d).toBeNull();
  });
});

describe('changeMessage', () => {
  it('compone titolo e corpo con prezzo e disponibilità', () => {
    const d = detectExternalChange(prev(20, 'in_stock'), { price: 25, availability: 'out_of_stock' })!;
    const { title, body } = changeMessage('Cuffie Bluetooth', d);
    expect(title).toContain('Cuffie Bluetooth');
    expect(body).toMatch(/aumentato da €20\.00 a €25\.00/);
    expect(body).toMatch(/esaurito/);
  });
});
