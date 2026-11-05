import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderSummary } from '@/components/checkout/OrderSummary';

const base = {
  subtotal: 0, shipping: 0, pickupDiscount: 0, couponDiscount: 0, total: 0,
  isCheckingOut: false, paymentMethod: 'cod' as const, disabled: true, motivoBlocco: 'Non riesco a leggere il carrello.',
};

describe('S07 · la cassa che non legge il carrello non scrive cifre a zero', () => {
  it('senza importi letti: niente «Subtotale 0,00 €», «Gratis», «Totale 0,00 €»', () => {
    const html = renderToStaticMarkup(<OrderSummary {...base} importiLetti={false} />);
    expect(html).not.toMatch(/0,00/);
    expect(html).not.toContain('Gratis');
    expect(html).toContain('Il riepilogo con le cifre compare appena riesco a leggere il carrello.');
    expect(html).toContain('Ordina e paga alla consegna');
  });
  it('con gli importi letti il riepilogo resta com’era', () => {
    const html = renderToStaticMarkup(<OrderSummary {...base} subtotal={8} shipping={4} total={12} disabled={false} />);
    expect(html).toContain('12,00');
    expect(html).toContain('Subtotale');
  });
  it('la cassa passa importiLetti dai gruppi letti, e la barra del telefono non scrive 0,00 €', () => {
    const src = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(src).toMatch(/importiLetti=\{groups\.length > 0\}/);
    expect(src).toMatch(/\{groups\.length > 0 \? formatPrice\(finalTotal\) : '—'\}/);
  });
});

describe('S07 · la cassa vuota è lo stato vuoto del carrello', () => {
  it('usa EmptyState con l’icona, il titolo e un rimando ai propri ordini', () => {
    const src = readFileSync('app/checkout/page.tsx', 'utf8');
    const vuota = src.slice(src.indexOf('if (vistaCarrello.mostraVuoto)'), src.indexOf('if (vistaCarrello.mostraVuoto)') + 900);
    expect(vuota).toMatch(/<EmptyState/);
    expect(vuota).toMatch(/title="Il tuo carrello è vuoto"/);
    expect(vuota).toMatch(/secondaryHref="\/orders"/);
    expect(vuota).not.toMatch(/Torna al negozio/);
  });
});
