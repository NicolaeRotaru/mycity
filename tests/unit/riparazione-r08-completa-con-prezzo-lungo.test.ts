import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'components/cart/CartUpsell.tsx'), 'utf8');
const righe = src.split('\n');
const rigaPrezzo = righe.find((l) => l.includes('formatPrice(p.price)'))!;
const iPrezzo = righe.indexOf(rigaPrezzo);
// La riga che contiene prezzo e «+»: l'ultimo <div> aperto prima del prezzo.
const rigaContenitore = righe.slice(0, iPrezzo).reverse().find((l) => /<div className=/.test(l))!;

/**
 * R08-006 — Un prezzo da 5000 € in su («5.000,00 €») nel «completa con» spingeva fuori il «+».
 * Il prezzo non si tronca (chi legge non vedrebbe l'importo): resta intero, e se non c'è posto
 * la riga va a capo, così il «+» scende sotto il prezzo invece di uscire dalla scheda.
 */
describe('R08-006 prezzo lungo nel «completa con»', () => {
  it('il prezzo resta intero: mai troncato con i puntini', () => {
    expect(rigaPrezzo).not.toMatch(/\btruncate\b/);
    expect(rigaPrezzo).not.toMatch(/text-ellipsis|overflow-hidden/);
  });
  it('il prezzo non va a capo a metà: whitespace-nowrap', () => {
    expect(rigaPrezzo).toMatch(/whitespace-nowrap/);
  });
  it('la riga con prezzo e «+» va a capo quando non c\'è posto: flex-wrap', () => {
    expect(rigaContenitore).toMatch(/\bflex\b/);
    expect(rigaContenitore).toMatch(/\bflex-wrap\b/);
  });
  it('il pulsante «+» non si stringe mai e non esce dalla riga', () => {
    const i = src.indexOf('aria-label={`Aggiungi');
    const blocco = src.slice(i, i + 400);
    expect(blocco).toMatch(/shrink-0/);
    // senza flex-wrap un prezzo largo lo spingerebbe fuori: lo stesso controllo del test sopra, sul contenitore.
    expect(rigaContenitore).toMatch(/flex-wrap/);
  });
});
