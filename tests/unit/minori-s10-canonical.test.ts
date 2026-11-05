import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S10 (5/11/2026, scheda 570) — il layout radice non dichiara il canonical
 * della home per tutte le pagine; lo dichiara la home.
 */
describe('il canonical «/» vale solo per la home (570)', () => {
  it('app/layout.tsx non ha alternates.canonical né openGraph.url', () => {
    const src = readFileSync('app/layout.tsx', 'utf8');
    expect(src).not.toMatch(/alternates:\s*\{\s*canonical:/);
    expect(src).not.toMatch(/siteName: 'MyCity',\s*url: '\/'/);
  });
  it('app/page.tsx lo dichiara per sé', () => {
    expect(readFileSync('app/page.tsx', 'utf8')).toMatch(/export const metadata: Metadata = \{ alternates: \{ canonical: '\/' \} \};/);
  });
});
