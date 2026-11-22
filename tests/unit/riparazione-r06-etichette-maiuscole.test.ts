import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R06-012 — La stessa etichetta maiuscola respirava in otto modi diversi
 * (tracking-wider, tracking-[0.03em], [0.05em], [0.06em], [0.08em], widest…), mentre il
 * design dichiara un valore solo per le maiuscole: tracking-label = 0.04em
 * (tailwind.config.ts, letterSpacing.label; in quel file anche `wide` vale 0.04em).
 *
 * Nei file di R06 ogni riga con `uppercase` che porta una spaziatura usa tracking-label.
 * Controllo sul sorgente: le classi di Tailwind non diventano stile in jsdom, quindi si
 * leggono le righe, come fa la prova di R22-019.
 */
const FILE = [
  'components/seller/SellerShell.tsx',
  'components/admin/AdminSidebar.tsx',
  'app/rider/earnings/page.tsx',
  'app/search/page.tsx',
  'components/home/DropOfDay.tsx',
];

describe('R06-012 · una sola spaziatura per le etichette maiuscole', () => {
  it.each(FILE)('%s: le etichette uppercase usano tracking-label', (file) => {
    const righe = readFileSync(file, 'utf8')
      .split('\n')
      .filter((r) => /\buppercase\b/.test(r) && /tracking-/.test(r));
    expect(righe.length, 'il file non ha più etichette maiuscole con spaziatura: la prova non misura niente').toBeGreaterThan(0);
    for (const r of righe) {
      const classi = [...r.matchAll(/tracking-(?:\[[^\]]+\]|[a-z]+)/g)].map((m) => m[0]);
      for (const c of classi) expect(c, `${file}: ${r.trim()}`).toBe('tracking-label');
    }
  });

  it('tracking-label vale ancora 0.04em, il token delle maiuscole del design', () => {
    const conf = readFileSync('tailwind.config.ts', 'utf8');
    expect(conf).toMatch(/label: '0\.04em'/);
  });
});
