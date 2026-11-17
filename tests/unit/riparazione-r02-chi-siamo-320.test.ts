/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R02-002 — A 320 PX COL TESTO AL 200% «CHI SIAMO» SCORREVA ANCORA DI LATO DI 17 PX.
 *
 * 320 px è la larghezza di riferimento WCAG per il reflow. La parola «esistiamo» del titolo
 * «Perché esistiamo» era più larga della colonna: il titolo sta in una griglia, e senza `min-w-0`
 * la colonna non scende sotto la parola più lunga (la pagina arrivava a 337 px). Sistemato il
 * titolo, le tre schede dei valori allargavano ancora la pagina di 5 px per lo stesso motivo.
 * Misurato in Chromium (Playwright) su `next dev`, html{font-size:200%}: prima 337 px su 320,
 * dopo 320 (anche con la sillabazione spenta), e a 360 resta 360. Qui la prova leggera sulle classi
 * che lo fanno, sulla pagina vera.
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

async function pagina(): Promise<Document> {
  const html = renderToStaticMarkup(await AboutPage());
  return new DOMParser().parseFromString(html, 'text/html');
}

const classi = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('R02-002 · «Chi siamo» a 320 px col testo al 200% non scorre di lato', () => {
  it('«Perché esistiamo» va a capo dentro la parola, e la sua colonna può stringersi', async () => {
    const doc = await pagina();
    const titolo = Array.from(doc.querySelectorAll('h2')).find((h) => h.textContent?.includes('Perché esistiamo'));
    expect(titolo, 'il titolo «Perché esistiamo» c è').toBeTruthy();
    expect(classi(titolo)).toContain('break-words');
    expect(classi(titolo)).toContain('hyphens-auto');
    // Il genitore è la cella della griglia: senza min-w-0 non scende sotto la parola più lunga.
    expect(classi(titolo!.parentElement?.parentElement)).toContain('grid');
    expect(classi(titolo!.parentElement), 'la cella della griglia non ha min-w-0: resta larga quanto «esistiamo»').toContain('min-w-0');
  });

  it('le tre schede dei valori possono stringersi e vanno a capo', async () => {
    const doc = await pagina();
    const schede = Array.from(doc.querySelectorAll('h3')).map((h) => h.parentElement!);
    expect(schede.length).toBeGreaterThanOrEqual(3);
    for (const s of schede.slice(0, 3)) {
      expect(classi(s.parentElement)).toContain('grid');
      expect(classi(s)).toContain('min-w-0');
      expect(classi(s)).toContain('break-words');
    }
  });
});
