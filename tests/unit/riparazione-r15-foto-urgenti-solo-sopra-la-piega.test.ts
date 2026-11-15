/**
 * R15-006 — Quattro foto sotto la piega venivano chieste come «urgenti» su ogni home. Prova leggera
 * (i componenti qui non si montano): le file della griglia non marcano nessuna foto come urgente,
 * /promozioni ne marca solo la prima riga, e le promo della home e le collezioni del negozio non ne marcano.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (f: string) => readFileSync(join(process.cwd(), ...f.split('/')), 'utf8');

describe('R15-006 foto urgenti solo sopra la piega', () => {
  it('la griglia non marca urgente nessuna foto di una fila', () => {
    expect(leggi('components/ProductGrid.tsx')).toMatch(/priority=\{prioritaPrimeFoto && !formaFila && i < 4\}/);
  });
  it('/promozioni marca urgente solo la prima riga', () => {
    const src = leggi('app/promozioni/page.tsx');
    expect(src).toMatch(/priority=\{i < 4\}/);
    expect(src).not.toMatch(/priority=\{i < 6\}/);
  });
  it('le promo della home e le collezioni del negozio non chiedono foto urgenti', () => {
    expect(leggi('components/home/PromoDeals.tsx')).toMatch(/priority=\{false\}/);
    expect(leggi('components/store-sections/CollectionSection.tsx')).toMatch(/priority=\{false\}/);
  });
});
