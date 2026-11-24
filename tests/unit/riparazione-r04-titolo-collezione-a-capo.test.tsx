// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Package } from 'lucide-react';
import CollectionHeader from '@/components/CollectionHeader';

/**
 * R04-006 e R04-007 — a 280 px col testo al 200% il titolo grande di CollectionHeader
 * non andava a capo sulle parole lunghe e usciva dalla riga. Il titolo deve poter spezzare
 * la parola (`break-words`) dentro il suo contenitore con `min-w-0`.
 */
describe('R04-006 R04-007 — il titolo di CollectionHeader va a capo', () => {
  it('l\'h1 ha break-words e sta in un contenitore min-w-0', () => {
    const c = document.createElement('div');
    c.innerHTML = renderToStaticMarkup(
      createElement(CollectionHeader, { eyebrow: 'Eyebrow', title: 'Anticostituzionalissimamente', icon: Package }),
    );
    const h1 = c.querySelector('h1') as HTMLElement;
    expect(h1.className).toMatch(/\bbreak-words\b/);
    expect(h1.parentElement?.className).toMatch(/\bmin-w-0\b/);
  });
});
