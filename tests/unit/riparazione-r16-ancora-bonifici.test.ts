/**
 * R16-010 — L'ancora #bonifici sommava scroll-mt-24 allo scroll-padding di html da md in su.
 * Prova leggera sul sorgente: il form con id="bonifici" porta anche md:scroll-mt-0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('R16-010 · ancora #bonifici', () => {
  it('il form ha scroll-mt-24 sul telefono e md:scroll-mt-0 da md in su', () => {
    const src = readFileSync(join(process.cwd(), 'components/seller/DatiPerIBonifici.tsx'), 'utf8');
    const m = src.match(/<form id="bonifici"[^>]*className="([^"]*)"/);
    expect(m, 'il form #bonifici non c è più').not.toBeNull();
    const classi = m![1].split(/\s+/);
    expect(classi).toContain('scroll-mt-24');
    expect(classi).toContain('md:scroll-mt-0');
  });
});
