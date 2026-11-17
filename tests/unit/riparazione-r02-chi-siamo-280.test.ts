/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R02-002 (onda 9) — A 280 PX COL TESTO AL 200% «CHI SIAMO» SCORREVA ANCORA DI LATO.
 *
 * 280 px è lo schermo esterno dei telefoni pieghevoli. Col testo al 200% (1rem = 32 px) tra i
 * margini della pagina (px-6) restano 184 px. Misurato in Chrome (Playwright) su `next dev`,
 * html{font-size:200%}: la pagina arrivava a 319 px.
 *  - le caselle dei numeri avevano colonne larghe ALMENO 8rem (256 px): uscivano fino a 304;
 *  - nella banda scura finale (p-8 = 64 px per lato) «Apri un negozio» non poteva stringersi
 *    e usciva fino a 319.
 * Dopo: il contenuto di «Chi siamo» resta dentro i 280 px (restano la barra in alto e il piede, che
 * non sono di questa pagina), e a 320, 360, 390 px col testo al 130-200% nulla cambia.
 * Qui la prova leggera sulle classi che lo fanno, sulla pagina vera.
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

describe('R02-002 · «Chi siamo» a 280 px col testo al 200% non scorre di lato', () => {
  it('le colonne dei numeri non sono mai più larghe della riga: min(100%, …)', async () => {
    const doc = await pagina();
    const casella = Array.from(doc.querySelectorAll('div')).find((d) => d.textContent?.trim().startsWith('Alla consegna'));
    expect(casella, 'la casella «Alla consegna» c è').toBeTruthy();
    const griglia = casella!.parentElement!;
    expect(classi(griglia)).toContain('grid');
    const colonne = classi(griglia).find((c) => c.startsWith('grid-cols-[')) ?? '';
    // Senza min(100%,…) la colonna resta di almeno 8rem anche dove la riga è più stretta.
    expect(colonne).toBe('grid-cols-[repeat(auto-fit,minmax(min(100%,max(8rem,calc((100%_-_1rem)/2))),1fr))]');
    // E nella casella stretta anche le parole della didascalia vanno a capo.
    expect(classi(casella)).toContain('min-w-0');
    expect(classi(casella)).toContain('break-words');
  });

  it('nella banda finale meno margine sul telefono, e i due bottoni si stringono e vanno a capo', async () => {
    const doc = await pagina();
    const titolo = Array.from(doc.querySelectorAll('h2')).find((h) => h.textContent?.includes('Vuoi farne parte?'));
    expect(titolo, 'la banda «Vuoi farne parte?» c è').toBeTruthy();
    const banda = titolo!.parentElement!.parentElement!;
    expect(classi(banda)).toContain('bg-ink-900');
    expect(classi(banda)).toContain('px-4');
    expect(classi(banda), 'p-8 per lato sotto sm non lascia posto ai bottoni').not.toContain('p-8');
    expect(classi(banda)).toContain('sm:p-8');

    for (const testo of ['Lavora con noi', 'Apri un negozio']) {
      const link = Array.from(banda.querySelectorAll('a')).find((a) => a.textContent?.includes(testo));
      expect(link, `il bottone «${testo}» c è`).toBeTruthy();
      expect(classi(link)).toContain('max-w-full');
      expect(classi(link)).toContain('flex-wrap');
      expect(classi(link)).toContain('px-4');
      expect(classi(link)).not.toContain('px-5');
      const etichetta = Array.from(link!.querySelectorAll('span')).find((s) => s.textContent === testo);
      expect(etichetta, `«${testo}» sta in un pezzo che può stringersi`).toBeTruthy();
      expect(classi(etichetta)).toContain('min-w-0');
      for (const icona of Array.from(link!.querySelectorAll('svg'))) expect(classi(icona)).toContain('shrink-0');
    }
  });
});
