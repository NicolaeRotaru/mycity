/**
 * ARMONIA NASCOSTA (Nicola, 28/11/2026): «piano piano ci lavoreremo». La misura conta i file che
 * disegnano qualcosa e quanti usano già l'armonia. Queste prove dicono che il conto riconosce le
 * classi nuove di Tailwind e che non scambia per armonia le classi che c'erano già.
 */
import { describe, expect, it } from 'vitest';
import { disegna, inArmonia, misura, PIANO } from '../../scripts/armonia-adozione.mjs';

describe('la misura dell\'armonia', () => {
  it('riconosce le classi e i componenti dell\'armonia', () => {
    expect(inArmonia('<div className="grid gap-f3 p-f4">')).toBe(true);
    expect(inArmonia('<h2 className="text-aurea-2">')).toBe(true);
    expect(inArmonia('<section className="grid sm:grid-cols-aurea max-w-aurea">')).toBe(true);
    expect(inArmonia("import TramaNascosta from '@/components/armonia/TramaNascosta';")).toBe(true);
    expect(inArmonia('style={{ "--armonia-durata": "333ms" }}')).toBe(true);
  });

  it('non scambia per armonia le classi che c\'erano già', () => {
    expect(inArmonia('<div className="p-4 gap-3 text-2xl max-w-7xl grid-cols-2 ease-out">')).toBe(false);
    expect(inArmonia('<div className="flex-1 shrink-0">')).toBe(false);
  });

  it('conta solo i file che disegnano qualcosa', () => {
    expect(disegna('export const x = 1;')).toBe(false);
    expect(disegna('<p className="text-sm">ciao</p>')).toBe(true);
  });

  it('sul marketplace vero trova la bozza del sito e il piè di pagina già in armonia, e il piano parte dai negozi', () => {
    const m = misura();
    expect(m.visibili).toBeGreaterThan(100);
    expect(m.file_in_armonia).toEqual(expect.arrayContaining(['components/Footer.tsx', 'components/seller/AnteprimaServizio.tsx']));
    expect(PIANO[0].file).toBe('app/store');
    expect(PIANO[PIANO.length - 1].file).toBe('app/checkout');
  });
});
