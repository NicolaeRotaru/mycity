import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { discountedUnitCents } from '@/lib/promotions';

describe('S07 · carrello e cassa leggono lo stesso indirizzo', () => {
  it('tutte e due ordinano per predefinito e poi per id: senza predefinito la prima riga è la stessa', () => {
    for (const f of ['app/cart/page.tsx', 'app/checkout/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      const lettura = src.slice(src.indexOf(".from('user_addresses')"), src.indexOf(".from('user_addresses')") + 600);
      expect(lettura, f).toMatch(/\.order\('is_default', \{ ascending: false \}\)[\s\S]*?\.order\('id', \{ ascending: true \}\)/);
    }
  });
});

describe('S07 · «Promozioni» ordina sul prezzo scontato che si vede', () => {
  it('il confronto usa il prezzo con lo sconto, non il pieno', () => {
    const src = readFileSync('app/promozioni/page.tsx', 'utf8');
    expect(src).toMatch(/case 'price_asc':\s*return arr\.sort\(\(a, b\) => prezzoMostrato\(a\) - prezzoMostrato\(b\)\)/);
    expect(src).toMatch(/case 'price_desc':\s*return arr\.sort\(\(a, b\) => prezzoMostrato\(b\) - prezzoMostrato\(a\)\)/);
    expect(src).toMatch(/discountedUnitCents\(Number\(p\.price\), p\.discount_percent \?\? 0\)/);
  });
  it('esempio: 10 € al 50% viene prima di 7 € al 10%', () => {
    expect(discountedUnitCents(10, 50)).toBeLessThan(discountedUnitCents(7, 10));
  });
});
