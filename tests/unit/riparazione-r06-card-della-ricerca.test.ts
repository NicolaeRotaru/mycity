import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from '@/components/ui/Card';

/**
 * R06-002 — La primitiva Card era usata in pochi file e le card si ridisegnavano a mano
 * (bg-white border border-cream-300 rounded-*). Il raggio per contesto la primitiva lo
 * offre già (R10-010). Nei file di R06 l'unica card di contenuto scritta a mano era la
 * colonna dei filtri della ricerca (app/search/page.tsx): adesso passa dalla primitiva,
 * con le stesse classi di prima, quindi senza cambiare aspetto.
 */
const ricerca = readFileSync('app/search/page.tsx', 'utf8');
const VECCHIE = 'hidden md:block md:col-span-1 bg-white border border-cream-300 rounded-2xl p-4 h-fit md:sticky md:top-[var(--header-height)] shadow-warm';
const insieme = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

describe('R06-002 · la colonna dei filtri della ricerca usa la primitiva Card', () => {
  it('la pagina importa Card e la usa come <aside>', () => {
    expect(ricerca).toMatch(/import \{ Card \} from '@\/components\/ui\/Card'/);
    expect(ricerca).toMatch(/<Card as="aside" variant="elevated" radius="2xl"/);
  });

  it('nessuna <aside> ridisegna più la card a mano', () => {
    expect(ricerca).not.toMatch(/<aside className="[^"]*bg-white border border-cream-300 rounded-/);
  });

  it('la card ha le stesse classi della versione scritta a mano', () => {
    const props: ComponentProps<typeof Card> = {
      as: 'aside',
      variant: 'elevated',
      radius: '2xl',
      className: 'hidden md:block md:col-span-1 h-fit md:sticky md:top-[var(--header-height)]',
      children: 'x',
    };
    const html = renderToStaticMarkup(createElement(Card, props));
    expect(html.startsWith('<aside')).toBe(true);
    const classi = html.match(/class="([^"]*)"/)?.[1] ?? '';
    expect(insieme(classi)).toEqual(insieme(VECCHIE));
  });
});
