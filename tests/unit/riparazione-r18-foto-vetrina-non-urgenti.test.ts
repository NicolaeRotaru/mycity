/**
 * R18-005 — La griglia della vetrina del negozio è l'ultima sezione della home del negozio: sta sotto
 * la piega, quindi le sue foto non devono essere chieste come «urgenti». Prova leggera sul sorgente.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (f: string) => readFileSync(join(process.cwd(), ...f.split('/')), 'utf8');

describe('R18-005 la vetrina del negozio non chiede foto urgenti', () => {
  it('la griglia del negozio spegne prioritaPrimeFoto', () => {
    const src = leggi('components/StoreProductExplorer.tsx');
    const blocco = src.slice(src.indexOf('<ProductGrid'));
    expect(blocco).toMatch(/prioritaPrimeFoto=\{false\}/);
  });
  it('la griglia ha ancora il parametro e le altre sedi restano come prima', () => {
    expect(leggi('components/ProductGrid.tsx')).toMatch(/prioritaPrimeFoto = true/);
    expect(leggi('components/home/PromoDeals.tsx')).toMatch(/priority=\{false\}/);
    expect(leggi('components/store-sections/CollectionSection.tsx')).toMatch(/priority=\{false\}/);
  });
});
