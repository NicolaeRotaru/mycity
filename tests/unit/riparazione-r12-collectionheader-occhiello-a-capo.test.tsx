// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Package } from 'lucide-react';
import CollectionHeader from '@/components/CollectionHeader';

describe('R12-008 — l\'occhiello maiuscolo di CollectionHeader va a capo', () => {
  it('il paragrafo dell\'occhiello ha break-words e sta in un contenitore min-w-0', () => {
    const c = document.createElement('div');
    c.innerHTML = renderToStaticMarkup(
      createElement(CollectionHeader, { eyebrow: 'Anticostituzionalissimamente', title: 'Titolo', icon: Package }),
    );
    const occhiello = Array.from(c.querySelectorAll('p')).find((p) => p.textContent === 'Anticostituzionalissimamente') as HTMLElement;
    expect(occhiello.className).toMatch(/\bbreak-words\b/);
    expect(occhiello.parentElement?.className).toMatch(/\bmin-w-0\b/);
  });
});
