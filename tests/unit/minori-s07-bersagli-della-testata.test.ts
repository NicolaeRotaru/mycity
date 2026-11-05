import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('S07 · i bersagli piccoli della testata', () => {
  it('la pausa della striscia è larga 44 px', () => {
    const src = readFileSync('components/PromoTicker.tsx', 'utf8');
    const bottone = src.slice(src.indexOf("aria-label={inPausa"), src.indexOf('</button>'));
    expect(bottone).toMatch(/\bw-11\b/);
    expect(bottone).not.toMatch(/\bpx-2\b/);
  });
  it('la pillola del CAP ha un’area di tocco alta 44 px (28 + 2×8)', () => {
    const src = readFileSync('components/LocationPill.tsx', 'utf8');
    const pillola = src.slice(src.indexOf('ref={pillolaRef}'), src.indexOf('title="Cambia indirizzo di consegna"'));
    expect(pillola).toMatch(/py-1\.5/);
    expect(pillola).toMatch(/before:absolute before:inset-x-0 before:-inset-y-2/);
  });
});
