// @vitest-environment jsdom
/**
 * R24-001 — Accanto alle ombre calde del brand c'erano ombre nere fredde della scala Tailwind
 * (shadow, shadow-sm, shadow-md, shadow-lg, shadow-2xl). Ogni superficie usa un token del brand:
 * shadow-warm*, shadow-card, shadow-sm-neutral.
 *  ① il «Drop del giorno» VERO: il pulsante «Acquista subito» porta un'ombra calda;
 *  ② nei file di questa riparazione non resta nessuna classe d'ombra della scala nera. (Per la
 *    pagina di ricerca, che non si monta in prova, è un controllo sul sorgente, dichiarato.)
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';

vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }) }));
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: unknown; href: string; className?: string }) =>
    createElement('a', { href, className }, children as never),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    isLoading: false,
    data: {
      id: 'd1', drop_date: '2026-11-13', discount_percent: 20, original_price: 10, drop_price: 8, headline: null,
      product: { id: 'p1', name: 'Pane', description: null, images: null, profiles: { id: 's1', store_name: 'Forno' } },
    },
  }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: DropOfDay } = await import('@/components/home/DropOfDay');

const CLASSE_NERA = /(?<![\w:-])(?:[a-z-]+:)*shadow(?:-(?:sm|md|lg|xl|2xl|inner))?(?![\w-])/g;
const TOKEN_OK = /^shadow(?:-warm(?:-sm|-lg|-xl)?|-card|-sm-neutral|-none)$/;

describe('R24-001 — le ombre sono quelle del brand', () => {
  it('il pulsante «Acquista subito» del Drop del giorno ha un\'ombra calda', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(createElement(DropOfDay)); });
    const pulsante = [...div.querySelectorAll('a')].find((a) => /Acquista subito/.test(a.textContent ?? ''))!;
    expect(pulsante).toBeTruthy();
    const ombre = pulsante.className.split(/\s+/).filter((c) => /(^|:)shadow/.test(c));
    expect(ombre.length).toBeGreaterThan(0);
    for (const o of ombre) expect(o, 'ombra nera della scala Tailwind').toMatch(TOKEN_OK);
    root.unmount();
  });

  it.each([
    'app/search/page.tsx',
    'components/home/DropOfDay.tsx',
    'components/ProductCard.tsx',
    'app/orders/[id]/page.tsx',
  ])('%s: nessuna ombra nera della scala Tailwind', (file) => {
    const src = readFileSync(file, 'utf8');
    const trovate = [...src.matchAll(CLASSE_NERA)].map((m) => m[0]).filter((c) => !/shadow-none$/.test(c) && !TOKEN_OK.test(c.replace(/^(?:[a-z-]+:)*/, '')));
    expect(trovate).toEqual([]);
  });
});
