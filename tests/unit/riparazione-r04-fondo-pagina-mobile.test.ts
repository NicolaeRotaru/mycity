import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R04-022 — In fondo a ogni pagina mobile restavano ~14px di vuoto: il padding
 * del body usava 72px mentre la barra a schede vera e' alta ~57,5px. Il fondo
 * della pagina ora usa l'altezza vera, calcolata qui dalle classi della barra.
 */

const CSS = readFileSync('app/globals.css', 'utf8');
const BARRA = readFileSync('components/MobileTabBar.tsx', 'utf8');

/** L'altezza della barra dalle sue classi: bordo + py-2 + icona + gap-0.5 + etichetta 11px × 1,5. */
function altezzaDalleClassi(): number {
  expect(BARRA).toMatch(/border-t /);
  expect(BARRA).toMatch(/gap-0\.5 py-2/);
  const icona = Number(BARRA.match(/<Icon size=\{(\d+)\}/)?.[1]);
  const testo = Number(BARRA.match(/text-\[(\d+)px\] font-medium/)?.[1]);
  return 1 + 8 + 8 + icona + 2 + testo * 1.5;
}

describe('il fondo della pagina mobile finisce dove finisce la barra', () => {
  it('il padding del body usa l\'altezza vera, non i 72px', () => {
    expect(CSS).toMatch(/body \{ padding-bottom: calc\(var\(--tabbar-altezza-vera\) \+ env\(safe-area-inset-bottom, 0\)\); \}/);
  });

  it('l\'altezza vera dichiarata e\' quella della barra, al pixel', () => {
    const dichiarata = Number(CSS.match(/--tabbar-altezza-vera:\s*(\d+)px/)?.[1]);
    const vera = altezzaDalleClassi();
    expect(Math.abs(dichiarata - vera)).toBeLessThanOrEqual(1);
  });

  it('dove la barra non c\'e\' anche il fondo vale zero', () => {
    expect(CSS).toMatch(/body\.senza-tabbar \{[^}]*--tabbar-altezza-vera: 0px/);
    expect(CSS).toMatch(/@media \(min-width: 768px\) \{\s*:root \{[^}]*--tabbar-altezza-vera: 0px/);
  });

  it('la pagina corta toglie la stessa altezza vera che il body riserva', () => {
    expect(CSS).toMatch(/min-height: calc\(100vh - var\(--header-height\) - var\(--tabbar-altezza-vera\)\)/);
  });
});
