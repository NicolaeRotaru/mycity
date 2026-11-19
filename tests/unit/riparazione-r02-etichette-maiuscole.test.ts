import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R02-008 (onda 9, giro 2) — La stessa etichetta maiuscola respirava in otto modi diversi
 * (tracking-wide, tracking-wider, tracking-[0.05em]…), mentre il design dichiara un valore solo per le
 * maiuscole: tracking-label = 0.04em (tailwind.config.ts, letterSpacing.label).
 *
 * Nei file di R02 ogni riga con `uppercase` che porta una spaziatura usa tracking-label. Controllo sul
 * sorgente, come le prove gemelle di R06-012 e R22-019: le classi di Tailwind non diventano stile in jsdom.
 * Fuori da questi file restano altre righe (le raccoglie la regista: serve_file_altrui).
 */
const FILE = [
  'app/returns/page.tsx',
  'app/admin/sponsored/page.tsx',
  'components/Footer.tsx',
  'components/Navbar.tsx',
  'components/ui/LegalLayout.tsx',
  'app/about/page.tsx',
  'app/lavora-con-noi/page.tsx',
];

describe('R02-008 · una sola spaziatura per le etichette maiuscole', () => {
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
    expect(readFileSync('tailwind.config.ts', 'utf8')).toMatch(/label: '0\.04em'/);
  });
});
