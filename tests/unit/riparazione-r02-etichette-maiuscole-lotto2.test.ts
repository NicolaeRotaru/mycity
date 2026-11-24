import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R02-015 — UNA SOLA SPAZIATURA PER LE ETICHETTE MAIUSCOLE.
 * Il design dichiara tracking-label = 0.04em (tailwind.config.ts, letterSpacing.label). Nei file di
 * questo lotto ogni riga con `uppercase` che porta una spaziatura usa tracking-label.
 */
const FILE = [
  'components/home/HowItWorks.tsx',
  'app/rider/availability/page.tsx',
  'app/seller/products/ai-batch/page.tsx',
  'app/not-found.tsx',
];

describe('R02-015 — etichette maiuscole con la spaziatura del design', () => {
  it.each(FILE)('%s: le etichette uppercase usano tracking-label', (file) => {
    const righe = readFileSync(file, 'utf8')
      .split('\n')
      .filter((r) => /\buppercase\b/.test(r) && /tracking-/.test(r));
    for (const r of righe) {
      const classi = [...r.matchAll(/tracking-(?:\[[^\]]+\]|[a-z]+)/g)].map((m) => m[0]);
      for (const c of classi) expect(c, `${file}: ${r.trim()}`).toBe('tracking-label');
    }
  });

  it('almeno un file del lotto porta davvero l\'etichetta con tracking-label', () => {
    const n = FILE.map((f) => readFileSync(f, 'utf8')).join('\n').match(/uppercase tracking-label/g) ?? [];
    expect(n.length).toBeGreaterThanOrEqual(4);
  });

  it('tracking-label vale ancora 0.04em', () => {
    expect(readFileSync('tailwind.config.ts', 'utf8')).toMatch(/label: '0\.04em'/);
  });
});
