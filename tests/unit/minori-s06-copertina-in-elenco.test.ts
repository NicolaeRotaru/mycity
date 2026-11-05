import { describe, it, expect } from 'vitest';
import { RIQUADRO_DELLA_FOTO } from '@/lib/media/foto-del-negozio';

/**
 * S06 · 1607 — La copertina nell'elenco negozi a tre colonne (1024-1279 punti)
 * si chiede per ~400 punti, non 320.
 */
function larghezzaChiesta(sizes: string, schermo: number): number {
  for (const clausola of sizes.split(',').map((c) => c.trim())) {
    const m = clausola.match(/^\(max-width:\s*(\d+)px\)\s*(\d+)(vw|px)$/);
    if (m) {
      if (schermo <= Number(m[1])) return m[3] === 'vw' ? (schermo * Number(m[2])) / 100 : Number(m[2]);
      continue;
    }
    const f = clausola.match(/^(\d+)(vw|px)$/);
    if (f) return f[2] === 'vw' ? (schermo * Number(f[1])) / 100 : Number(f[1]);
  }
  return NaN;
}

describe('1607 — elenco negozi a tre colonne', () => {
  it('a 1200 punti la scheda (~(1200-48-32)/3 = 373) non è chiesta più piccola', () => {
    const scheda = (1200 - 48 - 32) / 3;
    expect(larghezzaChiesta(RIQUADRO_DELLA_FOTO['scheda-in-elenco'], 1200)).toBeGreaterThanOrEqual(scheda);
  });
  it('a 1279 punti nemmeno', () => {
    expect(larghezzaChiesta(RIQUADRO_DELLA_FOTO['scheda-in-elenco'], 1279)).toBeGreaterThanOrEqual((1279 - 48 - 32) / 3);
  });
});
