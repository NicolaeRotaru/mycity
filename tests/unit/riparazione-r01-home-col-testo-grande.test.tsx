// @vitest-environment jsdom
/**
 * R01-015 — Col testo grande sul telefono la home scorreva di lato: accanto alle icone fisse il testo
 * non poteva stringersi sotto la parola più lunga, e il pulsante «Diventa venditore» non andava mai a
 * capo. Prova leggera (jsdom non misura): si disegnano le fasce vere e si guarda che ogni testo
 * accanto a un elemento fisso possa stringersi (`min-w-0`) e andare a capo (`break-words`), e che il
 * pulsante vada a capo solo sotto i 640 px (da lì in su, fascia in riga, resta su una riga come prima).
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: null, isAuthenticated: false, isLoading: false, isSeller: false, isAdmin: false }),
}));
vi.mock('@/components/LiveActivityFeed', () => ({ default: () => null }));
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));
vi.mock('@/components/home/HeroStoreCard', () => ({ default: () => null }));
vi.mock('@/components/home/HomeCtaLink', () => ({
  default: ({ href, children, className }: { href: string; children?: ReactNode; className?: string }) =>
    createElement('a', { href, className, 'data-cta': '1' }, children),
}));

import HomeSectionRenderer from '@/components/home-sections/HomeSectionRenderer';

function disegna(sections: unknown[]): HTMLElement {
  const html = renderToStaticMarkup(
    createElement(HomeSectionRenderer, {
      sections: sections as never,
      heroVariant: 'a',
      heroDefaults: { eyebrow: 'Piacenza', headline: 'Spesa sottocasa', subhead: 'x', ctaPrimary: 'Esplora' },
    }),
  );
  const radice = document.createElement('div');
  radice.innerHTML = html;
  return radice;
}

const classi = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

/** Il blocco di testo che sta accanto a un'icona che non si stringe (`shrink-0`). */
function testiAccantoAlleIcone(radice: HTMLElement): Element[] {
  return Array.from(radice.querySelectorAll('span'))
    .filter((s) => classi(s).includes('shrink-0'))
    .map((s) => s.nextElementSibling)
    .filter((e): e is Element => !!e && (e.tagName === 'DIV' || e.tagName === 'P'));
}

describe('R01-015 · col testo grande la home non scorre di lato', () => {
  it('«Perché scegliere MyCity»: il testo accanto all\'icona si stringe e va a capo', () => {
    const radice = disegna([{ id: 'live', type: 'liveActivity', config: {} }]);
    const testi = testiAccantoAlleIcone(radice);
    expect(testi.length).toBeGreaterThanOrEqual(3);
    for (const t of testi) {
      expect(classi(t), t.textContent ?? '').toContain('min-w-0');
      expect(classi(t), t.textContent ?? '').toContain('break-words');
    }
  });

  it('la banda fiducia: anche lì il testo accanto all\'icona va a capo', () => {
    const radice = disegna([{ id: 'fiducia', type: 'trustRow', config: {} }]);
    const testi = testiAccantoAlleIcone(radice);
    expect(testi.length).toBeGreaterThanOrEqual(3);
    for (const t of testi) expect(classi(t)).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
  });

  it('la fascia dei negozi: il pulsante va a capo solo sul telefono, la frase accanto allo scudo si stringe', () => {
    const radice = disegna([{ id: 'venditori', type: 'sellerCta', config: {} }]);
    const pulsante = radice.querySelector('a[data-cta]');
    expect(pulsante?.textContent).toContain('Diventa venditore');
    expect(classi(pulsante)).not.toContain('whitespace-nowrap');
    expect(classi(pulsante)).toEqual(expect.arrayContaining(['max-w-full', 'sm:whitespace-nowrap']));
    const [frase] = testiAccantoAlleIcone(radice);
    expect(classi(frase)).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
    expect(classi(frase?.parentElement ?? null)).toContain('min-w-0');
  });

  it('l\'hero: la colonna del titolo si stringe e il titolo va a capo', () => {
    const radice = disegna([{ id: 'hero', type: 'hero', config: {} }]);
    const h1 = radice.querySelector('h1');
    expect(classi(h1)).toContain('break-words');
    expect(classi(h1?.parentElement ?? null)).toContain('min-w-0');
  });
});
