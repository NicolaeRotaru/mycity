/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector';

/*
 * Giro di correzione (13/11): misurata in Chromium col CSS del progetto, a 360,
 * 375 e 390 px con il testo al 200% la cassa era larga 444 px; con min-w-0 sul
 * fieldset, sul titolo «Contanti alla consegna» e sul testo della riga
 * «Consegna a domicilio» non scorre più di lato. Quella misura non sta qui: il
 * lavoro «Unit tests» della CI non ha un Chromium, e una prova deve girare
 * dappertutto. Qui restano le classi che la misura ha dimostrato necessarie.
 */

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
  it('giro di correzione: il gruppo (fieldset) e il titolo «Contanti alla consegna» possono stringersi sotto il loro contenuto', () => {
    // Un <fieldset> per il browser ha min-width: min-content: senza min-w-0 si
    // allarga quanto la parola più lunga dentro e porta fuori tutta la pagina.
    const html = renderToStaticMarkup(
      <PaymentMethodSelector value="cod" onChange={() => {}} stripeAvailable multiSeller pickupInStore={false} onPickupChange={() => {}} pickupDiscount={0} pickupDiscountPercent={5} />,
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('fieldset')?.className ?? '').toMatch(/\bmin-w-0\b/);
    const titolo = [...doc.querySelectorAll('fieldset p')].find((p) => p.textContent === 'Contanti alla consegna');
    expect(titolo?.className ?? '').toMatch(/\bmin-w-0\b|overflow-wrap:anywhere/);
  });
  it('la colonna sinistra della cassa non si allarga oltre lo schermo (min-w-0)', () => {
    const src = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(src).toMatch(/<div className="min-w-0 lg:col-span-2 space-y-4">/);
  });
  it('la riga «Consegna a domicilio» lascia stringere il testo accanto alla cifra', () => {
    const src = readFileSync('app/checkout/page.tsx', 'utf8');
    const i = src.indexOf('<p className="font-bold text-ink-900">Consegna a domicilio</p>');
    expect(i).toBeGreaterThan(0);
    const prima = src.slice(Math.max(0, i - 300), i);
    expect(prima).toMatch(/<div className="[^"]*\bmin-w-0\b[^"]*">\s*$/);
  });
});
