import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R03-002 — Col testo ingrandito al massimo (Chrome a 360px, html{font-size:200%}) «Chi siamo»
 * scorreva di lato: il titolo text-4xl aveva una parola più larga dello schermo e la griglia dei
 * numeri restava a due colonne fisse con riquadri px-5. Misurato in Chromium (Playwright) su un
 * render statico con Fraunces vero: prima 410px su 360, dopo 360, e a testo normale le due colonne
 * restano due. Qui la prova leggera sulle classi che lo fanno, sulla pagina vera.
 */

vi.mock('@/lib/cms', () => ({ loadPublishedCmsPage: async () => null }));
vi.mock('@/components/cms/CmsPageView', () => ({ default: () => null }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: () => ({ select: async () => ({ count: 12 }) }) }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import AboutPage from '@/app/about/page';

async function html() {
  return renderToStaticMarkup(await AboutPage());
}

describe('R03-002 · «Chi siamo» col testo grande non scorre di lato', () => {
  it('il titolo va a capo dentro una parola troppo lunga', async () => {
    const classi = ((await html()).match(/<h1 class="([^"]*)"/)?.[1] ?? '').split(/\s+/);
    expect(classi).toContain('break-words');
    expect(classi).toContain('hyphens-auto');
  });

  it('la griglia dei numeri non è a due colonne fisse: colonne larghe almeno 8rem, al massimo mezza riga', async () => {
    const pagina = await html();
    const griglia = pagina.match(/<div class="(grid [^"]*)"><div class="min-w-0 bg-white/)?.[1] ?? '';
    expect(griglia, 'la griglia dei numeri c è').not.toBe('');
    const classi = griglia.split(/\s+/);
    expect(classi).not.toContain('grid-cols-2');
    expect(classi).toContain('grid-cols-[repeat(auto-fit,minmax(max(8rem,calc((100%_-_1rem)/2)),1fr))]');
    expect(classi).toContain('gap-4');
    expect(classi.some((c) => c === 'lg:grid-cols-4' || c === 'lg:grid-cols-3')).toBe(true);
  });
});
