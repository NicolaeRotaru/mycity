import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from '@/components/ui/Card';

/**
 * R07-003 — la primitiva deve coprire i motivi delle card scritte a mano, così passano alla Card
 * senza riscrivere le classi: raggio unico per contesto e varianti per i fondi/bordi più comuni.
 */
const classi = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(Card, { ...props, children: 'x' } as never)).match(/class="([^"]*)"/)?.[1] ?? '';

describe('R07-003 — varianti e raggio della Card', () => {
  it('surface: fondo surface-0 e bordo sabbia', () => {
    const c = classi({ variant: 'surface', radius: 'lg' });
    expect(c).toMatch(/\bbg-surface-0\b/);
    expect(c).toMatch(/\bborder-cream-300\b/);
    expect(c).toMatch(/\brounded-lg\b/);
  });
  it('quiet: bordo sabbia chiaro e ombra lieve', () => {
    const c = classi({ variant: 'quiet' });
    expect(c).toMatch(/\bborder-cream-200\b/);
    expect(c).toMatch(/\bshadow-warm-sm\b/);
  });
  it('le varianti di oggi non cambiano', () => {
    expect(classi({})).toBe('rounded-xl bg-white border border-cream-300 p-4');
    expect(classi({ variant: 'funnel' })).toBe('rounded-xl bg-white border border-surface-200 shadow-card p-4');
  });
});
