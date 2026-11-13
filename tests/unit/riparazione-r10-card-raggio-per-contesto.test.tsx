import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from '@/components/ui/Card';

/**
 * R10-010 — La primitiva Card aveva angoli da 12px (il raggio meno usato del
 * sito), quindi le card si ridisegnavano a mano con quattro raggi diversi.
 * Ora la regola è nella primitiva: 16px di base, 20px per prodotto/negozio,
 * 12px per i riquadri interni.
 */
const classi = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(Card, { ...props, children: 'x' } as never)).match(/class="([^"]*)"/)?.[1] ?? '';

describe('R10-010 — il raggio della card per contesto', () => {
  it('di base una card di contenuto ha 16px', () => {
    expect(classi({})).toMatch(/(^|\s)rounded-xl(\s|$)/);
    expect(classi({ variant: 'elevated' })).toMatch(/(^|\s)rounded-xl(\s|$)/);
  });
  it('la card prodotto/negozio chiede 20px', () => {
    expect(classi({ radius: '2xl' })).toMatch(/(^|\s)rounded-2xl(\s|$)/);
  });
  it('il riquadro interno chiede 12px', () => {
    expect(classi({ radius: 'lg' })).toMatch(/(^|\s)rounded-lg(\s|$)/);
  });
  it('la variante del percorso d’acquisto resta a 16px', () => {
    expect(classi({ variant: 'funnel' })).toMatch(/(^|\s)rounded-xl(\s|$)/);
  });
});
