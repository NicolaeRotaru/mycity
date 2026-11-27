// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from '@/components/ui/Card';

/**
 * R13-001 — la Card senza href perdeva aria-label; con href non passava al Link il resto
 * delle prop (id, role, aria-*, data-*).
 */
const radice = (props: Record<string, unknown>) => {
  const c = document.createElement('div');
  c.innerHTML = renderToStaticMarkup(createElement(Card, { ...props, children: 'dentro' } as never));
  return c.firstElementChild as HTMLElement;
};

describe('R13-001 — la Card passa le prop HTML all\'elemento', () => {
  it('senza href: aria-label, id, role e data-* arrivano sull\'elemento', () => {
    const el = radice({ 'aria-label': 'Riepilogo', id: 'riep', role: 'region', 'data-x': '1' });
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('aria-label')).toBe('Riepilogo');
    expect(el.id).toBe('riep');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('data-x')).toBe('1');
  });
  it('con href: il Link riceve aria-label, id, role, aria-* e data-*', () => {
    const el = radice({ href: '/aiuto', 'aria-label': 'Aiuto', id: 'lk', role: 'link', 'aria-describedby': 'd', 'data-x': '2' });
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/aiuto');
    expect(el.getAttribute('aria-label')).toBe('Aiuto');
    expect(el.id).toBe('lk');
    expect(el.getAttribute('role')).toBe('link');
    expect(el.getAttribute('aria-describedby')).toBe('d');
    expect(el.getAttribute('data-x')).toBe('2');
  });
});
