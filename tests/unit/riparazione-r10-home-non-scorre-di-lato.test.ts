// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R10-002 — La home scorreva di lato sul telefono col testo grande (360 px, html { font-size: 200% }):
 * la pagina arrivava a 422 px. A tenerla larga era il pulsante «Diventa venditore» della fascia
 * per i negozi, che non poteva andare a capo (`whitespace-nowrap`): con le lettere doppie la sua riga
 * è più larga dello schermo. Prova leggera sulla fascia disegnata davvero: il pulsante può andare a
 * capo e non supera la larghezza di chi lo contiene.
 */
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));
vi.mock('next/image', () => ({ default: () => null }));

async function fasciaVenditori(): Promise<HTMLAnchorElement | null> {
  const { default: HomeSectionRenderer } = await import('@/components/home-sections/HomeSectionRenderer');
  const html = renderToStaticMarkup(
    createElement(HomeSectionRenderer, {
      sections: [{ id: 'venditori', type: 'sellerCta', config: {} }] as never,
      heroVariant: 'a',
      heroDefaults: { eyebrow: 'x', headline: 'x', subhead: 'x', ctaPrimary: 'x' } as never,
    }),
  );
  const contenitore = document.createElement('div');
  contenitore.innerHTML = html;
  return Array.from(contenitore.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('Diventa venditore')) ?? null;
}

describe('R10-002 · la fascia «Diventa venditore» non allarga la home sul telefono', () => {
  it('il pulsante può andare a capo e resta dentro la larghezza dello schermo', async () => {
    const pulsante = await fasciaVenditori();
    expect(pulsante, 'la fascia per i negozi non ha più il pulsante «Diventa venditore»').not.toBeNull();
    const classi = (pulsante!.getAttribute('class') ?? '').split(/\s+/);
    expect(classi, 'con «whitespace-nowrap» la riga del pulsante non va a capo e col testo grande esce dallo schermo').not.toContain('whitespace-nowrap');
    expect(classi, 'il pulsante deve restare dentro la larghezza di chi lo contiene').toContain('max-w-full');
  });
});
