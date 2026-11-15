/**
 * R24-021 / R24-002 — La scala dei caratteri (10/12/14/16/18/20/24/30/36/48/60) era aggirata
 * ~330 volte con `text-[13px]` e simili. Nei file di questa riparazione ogni misura a mano che
 * ha un gradino uguale o più vicino nella scala adesso lo usa.
 *
 * Resta fuori, dichiarato, `text-[11px]`: nella scala non c'è l'11 e il registro non dice se
 * arrotondarlo a 10 o a 12 (serve un gradino nuovo in tailwind.config.ts, file di altri).
 * Controllo sul sorgente: le classi di Tailwind non si vedono in jsdom, quindi si leggono
 * le righe, e lo si dichiara.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILE = [
  'components/seller/SellerShell.tsx',
  'app/rider/earnings/page.tsx',
  'app/search/page.tsx',
  'components/admin/AdminSidebar.tsx',
  'app/orders/[id]/page.tsx',
  'app/reset-password/page.tsx',
  'app/seller/products/page.tsx',
  'app/sign-up/page.tsx',
  'app/cart/page.tsx',
  'app/product/[id]/page.tsx',
  'components/ProductCard.tsx',
  'components/home/TrendingNow.tsx',
];
/** Le misure che nella scala hanno un gradino uguale o più vicino (11 resta fuori: vedi sopra). */
const SCAVALCATE = ['9', '10', '12', '13', '13.5', '14', '15', '16', '22', '26', '34', '46'];
const CLASSE = /(?:[a-z]+:)*text-\[([0-9.]+)px\]/g;

describe('R24-021 / R24-002 — la scala dei caratteri non si aggira con le misure a mano', () => {
  it.each(FILE)('%s: nessun text-[Npx] che la scala ha già', (file) => {
    const codice = readFileSync(file, 'utf8')
      .split('\n')
      .filter((r) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(r))
      .join('\n');
    const trovate = [...codice.matchAll(CLASSE)].filter((m) => SCAVALCATE.includes(m[1])).map((m) => m[0]);
    expect(trovate).toEqual([]);
  });

  it('i gradini usati ci sono davvero nella scala dichiarata', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    for (const px of ['10px', '12px', '14px', '16px', '24px', '36px', '48px']) {
      expect(css).toContain(`/* ${px} */`);
    }
  });
});
