/**
 * S09 — 370: le categorie precaricate nella home si vedono già nell'HTML del server.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MaybeSection from '@/components/home/MaybeSection';

describe('370 — MaybeSection non spegne il contenuto disegnato dal server', () => {
  it('con un figlio pieno l\'HTML del server non ha la classe hidden', () => {
    const figlio = createElement('a', { href: '/category/alimentari' }, 'Alimentari');
    const html = renderToStaticMarkup(createElement(MaybeSection, { className: 'container', children: figlio }));
    expect(html).not.toContain('class="hidden"');
    expect(html).toContain('class="container"');
    expect(html).toContain('Alimentari');
  });
});
