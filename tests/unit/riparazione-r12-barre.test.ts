/**
 * R12 — LE BARRE DEL TELEFONO COL TESTO INGRANDITO.
 *
 * Col testo al 200% le misure in rem raddoppiano, quelle in px no. Qui si contano le misure dalle
 * classi dei componenti con la radice del testo a 16px (normale) e a 32px (200%).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('app/globals.css', 'utf8');
const BARRA = readFileSync('components/MobileTabBar.tsx', 'utf8');

/** Il valore di una misura CSS (px, rem, calc con + e *) con la radice del testo a `radice` pixel. */
function misuraConRadice(valore: string, radice: number): number {
  const espressione = valore
    .trim()
    .replace(/^calc\((.*)\)$/, '$1')
    .replace(/(\d*\.?\d+)rem/g, `($1*${radice})`)
    .replace(/(\d*\.?\d+)px/g, '$1');
  if (!/^[\d.\s+*()]+$/.test(espressione)) return Number.NaN;
  return Number(new Function(`return (${espressione});`)());
}

/** Un passo di Tailwind (py-2, gap-0.5) vale un quarto di rem. */
const passo = (classi: string, nome: string) => {
  const m = classi.match(new RegExp(`(?:^|\\s)${nome}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`));
  expect(m, `la barra non ha più ${nome}-N: la prova va rifatta sulla barra nuova`).toBeTruthy();
  return Number(m![1]) * 0.25;
};

/** L'altezza della barra a schede dalle sue classi, con la radice del testo a `radice` pixel. */
function altezzaDellaBarra(radice: number): number {
  const classiScheda = BARRA.match(/const tabClass = [^`]*`([^`$]*)/)?.[1] ?? '';
  const icona = Number(BARRA.match(/<Icon size=\{(\d+)\}/)?.[1]);
  const etichetta = Number(BARRA.match(/text-\[(\d+)px\] font-medium/)?.[1]);
  expect(Number.isFinite(icona) && Number.isFinite(etichetta), 'icona ed etichetta della barra si leggono').toBe(true);
  const bordo = /border-t /.test(BARRA) ? 1 : 0;
  // L'etichetta ha l'interlinea 1,5 che Tailwind mette su <html>.
  return bordo + 2 * passo(classiScheda, 'py') * radice + icona + passo(classiScheda, 'gap') * radice + etichetta * 1.5;
}

describe('R12-003 — il margine in fondo segue l\'altezza vera della barra a schede', () => {
  const dichiarata = CSS.match(/--tabbar-altezza-vera:\s*([^;]+);/)?.[1] ?? '';

  it('controprova: col testo normale la barra è alta 57,5 e il margine lo stesso', () => {
    expect(altezzaDellaBarra(16)).toBe(57.5);
    expect(Math.abs(misuraConRadice(dichiarata, 16) - 57.5)).toBeLessThanOrEqual(1);
  });

  it('col testo al 200% il margine in fondo non è più basso della barra', () => {
    const barra = altezzaDellaBarra(32);
    const margine = misuraConRadice(dichiarata, 32);
    expect(barra, 'controprova: col testo al 200% la barra cresce').toBeGreaterThan(70);
    expect(
      margine,
      `col testo al 200% la barra è alta ${barra}px e il margine in fondo ${margine}px: l'ultima parte della pagina finisce sotto la barra`,
    ).toBeGreaterThanOrEqual(barra);
    expect(margine - barra, 'il margine non lascia una striscia vuota').toBeLessThanOrEqual(1);
  });
});
