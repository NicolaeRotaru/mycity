// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R09-017 — «I più recensiti» non si presenta come «Scelti dai clienti»: la pagina mostra solo
 * prodotti con recensioni e l'occhiello non promette una scelta dei clienti.
 */
const header = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const griglia = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/components/ProductGrid', () => ({ default: (p: Record<string, unknown>) => { griglia.push(p); return null; } }));
vi.mock('@/components/CollectionHeader', () => ({ default: (p: Record<string, unknown>) => { header.push(p); return null; } }));

import PiuVendutiPage from '@/app/piu-venduti/page';

describe('R09-017 · occhiello onesto sui più recensiti', () => {
  it('l\'occhiello non dice «Scelti dai clienti» e la griglia vuole solo i recensiti', () => {
    renderToStaticMarkup(createElement(PiuVendutiPage));
    expect(String(header.at(-1)?.eyebrow)).not.toMatch(/scelti dai clienti/i);
    expect(header.at(-1)?.eyebrow).toBe('Con recensioni');
    expect(griglia.at(-1)?.soloRecensiti).toBe(true);
  });
});
