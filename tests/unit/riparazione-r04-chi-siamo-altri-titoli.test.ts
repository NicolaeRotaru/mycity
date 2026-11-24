/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R04-005 — in «Chi siamo» altri due titoli h2 («I nostri valori», «Vuoi farne parte?») non avevano
 * break-words né min-w-0, come quello già riparato. Prova leggera sulle classi, sulla pagina vera.
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

const classi = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('R04-005 — tutti i titoli h2 di «Chi siamo» vanno a capo', () => {
  it('ogni h2 ha break-words e lui o il suo genitore ha min-w-0', async () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(await AboutPage()), 'text/html');
    const h2 = Array.from(doc.querySelectorAll('h2'));
    expect(h2.length).toBeGreaterThanOrEqual(4);
    for (const t of h2) {
      expect(classi(t), t.textContent ?? '').toContain('break-words');
      expect([...classi(t), ...classi(t.parentElement)], t.textContent ?? '').toContain('min-w-0');
    }
  });
});
