// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from '@/components/ui/Card';

/**
 * R07-004 — la Card non poteva fare da link: le card cliccabili restavano scritte a mano.
 * Con `href` la card è un `<a>`; senza, resta com'era (un div con le stesse classi).
 */
const html = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(Card, { ...props, children: 'dentro' } as never));
const radice = (h: string) => {
  const c = document.createElement('div');
  c.innerHTML = h;
  return c.firstElementChild as HTMLElement;
};

describe('R07-004 — la Card può fare da link', () => {
  it('con href rende un <a href> con le classi della card e il contenuto', () => {
    const el = radice(html({ href: '/help/ordini', 'aria-label': 'Aiuto ordini' }));
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/help/ordini');
    expect(el.getAttribute('aria-label')).toBe('Aiuto ordini');
    expect(el.className).toMatch(/rounded-xl/);
    expect(el.className).toMatch(/border-cream-300/);
    expect(el.textContent).toBe('dentro');
  });
  it('senza href resta un div (o il tag chiesto) senza link', () => {
    const el = radice(html({}));
    expect(el.tagName).toBe('DIV');
    expect(el.hasAttribute('href')).toBe(false);
    expect(el.className).toBe('rounded-xl bg-white border border-cream-300 p-4');
    expect(radice(html({ as: 'article' })).tagName).toBe('ARTICLE');
  });
});
