// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R07-016 (12/11/2026) — la pagina «Sotto i 10 €» passa alla griglia la soglia sul prezzo
 * che si paga (`prezzoSotto`), non `maxPrice` (prezzo pieno, 10 compreso).
 */
const props = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/components/ProductGrid', () => ({ default: (p: Record<string, unknown>) => { props.push(p); return null; } }));
vi.mock('@/components/CollectionHeader', () => ({ default: () => null }));

import PiccoliPrezziPage from '@/app/piccoli-prezzi/page';

describe('R07-016 · la pagina chiede «sotto 10» sul prezzo pagato', () => {
  it('prezzoSotto = 10 e niente maxPrice', () => {
    renderToStaticMarkup(createElement(PiccoliPrezziPage));
    expect(props.at(-1)?.prezzoSotto).toBe(10);
    expect(props.at(-1)?.maxPrice).toBeUndefined();
  });
});
