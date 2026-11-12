import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R07-009 (12/11/2026) — le tre pagine collezione (Regali, Novità, I più recensiti) danno
 * alla griglia l'h2 invisibile che manca fra il loro h1 e l'h3 di ogni prodotto.
 */
const props = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/ProductGrid', () => ({ default: (p: Record<string, unknown>) => { props.push(p); return null; } }));
vi.mock('@/components/CollectionHeader', () => ({ default: () => null }));

beforeEach(() => { props.length = 0; });

describe('R07-009 · le pagine collezione danno l h2 alla griglia', () => {
  it.each([
    ['Novità', '@/app/novita/page'],
    ['I più recensiti', '@/app/piu-venduti/page'],
    ['Regali', '@/app/regali/RegaliClient'],
  ])('%s', async (_nome, percorso) => {
    const mod = (await import(/* @vite-ignore */ percorso)) as { default: ComponentType };
    renderToStaticMarkup(createElement(mod.default));
    expect(typeof props.at(-1)?.titoloNascosto).toBe('string');
    expect(String(props.at(-1)?.titoloNascosto).length).toBeGreaterThan(0);
  });
});
