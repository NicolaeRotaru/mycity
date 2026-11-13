import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector';

describe('R19-007 · le schede dei metodi di pagamento si restringono col testo grande', () => {
  it('ogni contenuto di scheda (flex-1 dentro una label flex) ha min-w-0 e va a capo', () => {
    const src = readFileSync('components/checkout/PaymentMethodSelector.tsx', 'utf8');
    const blocchi = src.match(/<div className="[^"]*\bflex-1\b[^"]*">/g) ?? [];
    expect(blocchi.length).toBeGreaterThanOrEqual(3);
    for (const b of blocchi) {
      expect(b).toMatch(/\bmin-w-0\b/);
      expect(b).toMatch(/\bbreak-words\b/);
    }
  });
  it('resa: la scheda «Contanti alla consegna» ha il contenuto con min-w-0 e il badge può andare a capo', () => {
    const html = renderToStaticMarkup(
      <PaymentMethodSelector value="cod" onChange={() => {}} stripeAvailable multiSeller pickupInStore={false} onPickupChange={() => {}} pickupDiscount={0} pickupDiscountPercent={5} />,
    );
    const i = html.indexOf('Contanti alla consegna');
    const prima = html.slice(Math.max(0, i - 400), i);
    expect(prima).toMatch(/min-w-0[^"]*flex-1|flex-1[^"]*min-w-0/);
    expect(prima).toMatch(/flex-wrap/);
  });
  it('la colonna sinistra della cassa non si allarga oltre lo schermo (min-w-0)', () => {
    const src = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(src).toMatch(/<div className="min-w-0 lg:col-span-2 space-y-4">/);
  });
});
