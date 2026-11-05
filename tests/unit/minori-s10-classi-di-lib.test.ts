import { describe, it, expect } from 'vitest';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import path from 'node:path';

/**
 * S10 (5/11/2026, scheda 277) — le classi scritte in lib/ (il cuore dei
 * preferiti, le copertine dei negozi) finiscono davvero nel CSS del sito.
 */
describe('Tailwind genera le classi scritte in lib/ (277)', () => {
  it('fill-secondary-500 e from-ink-700 ci sono', async () => {
    const config = path.resolve('tailwind.config.ts');
    const { css } = await postcss([tailwindcss({ config })]).process('@tailwind utilities;', { from: undefined });
    expect(css).toMatch(/\.fill-secondary-500\b/);
    expect(css).toMatch(/\.from-ink-700\b/);
  }, 60_000);
});
