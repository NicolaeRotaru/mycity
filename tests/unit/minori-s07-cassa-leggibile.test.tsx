import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScheletroCassa } from '@/components/checkout/ScheletroCassa';
import { CartGroupsList } from '@/components/checkout/CartGroupsList';

describe('S07 · la cassa si legge e si usa anche senza vedere bene', () => {
  it('mentre la cassa si prepara la regione viva ha un testo da annunciare', () => {
    const html = renderToStaticMarkup(<ScheletroCassa />);
    const regione = html.match(/<div role="status"[^>]*>([\s\S]*)$/)?.[1] ?? '';
    expect(regione).toMatch(/<span class="sr-only">Sto preparando il riepilogo dell(&#x27;|')ordine…<\/span>/);
  });

  it('l’elenco dei prodotti che scorre si raggiunge col Tab e ha un nome', () => {
    const html = renderToStaticMarkup(
      <CartGroupsList groups={[{ sellerId: 'n', storeName: 'Pane Quotidiano', items: [{ id: 'p', name: 'Pane', price: 2, quantity: 1 }] } as never]} />,
    );
    const contenitore = html.match(/<div[^>]*max-h-72[^>]*>/)?.[0] ?? '';
    expect(contenitore).toMatch(/tabindex="0"/);
    expect(contenitore).toMatch(/role="region"/);
    expect(contenitore).toMatch(/aria-label="Prodotti dell&#x27;ordine"|aria-label="Prodotti dell'ordine"/);
  });

  it('gli esempi di indirizzo e telefono cominciano con «Es.», come quello del nome', () => {
    const src = readFileSync('components/checkout/ShippingAddressForm.tsx', 'utf8');
    const esempi = [...src.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
    expect(esempi.length).toBeGreaterThanOrEqual(3);
    for (const e of esempi) expect(e, e).toMatch(/^Es\. /);
  });

  it('nessuna scritta sotto i 12 px nella barra d’acquisto e sul «Totale» della cassa', () => {
    expect(readFileSync('components/StickyAddToCart.tsx', 'utf8')).not.toMatch(/text-\[(10|11)px\]/);
    expect(readFileSync('app/checkout/page.tsx', 'utf8')).not.toMatch(/text-2xs[^"]*">Totale/);
  });
});
