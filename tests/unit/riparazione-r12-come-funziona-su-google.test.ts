/**
 * R12-020 — La descrizione di «Come funziona» che esce su Google prometteva il
 * reso «sui prodotti non deperibili», senza escludere quelli fatti su
 * ordinazione (fatto legale.recesso-esclusi).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/components/home/HowItWorks', () => ({ default: () => null }));

import { metadata } from '@/app/come-funziona/page';
import { FRASE_RESO } from '@/lib/promesse-pubbliche';

describe('R12-020 la descrizione su Google dice il reso giusto', () => {
  it('usa la frase del reso del sito, con gli esclusi', () => {
    expect(metadata.description).toContain(FRASE_RESO);
    expect(metadata.description).toMatch(/su ordinazione/);
  });
});

describe('R12-020 gli esclusi si vedono anche nel riquadro di Google', () => {
  it('la descrizione sta nei circa 160 caratteri che Google mostra', () => {
    expect(String(metadata.description).length).toBeLessThanOrEqual(160);
  });
});
