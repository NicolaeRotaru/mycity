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
// Il riquadro dell'attività dal vivo, con la lettura caduta, mostra l'avviso d'errore che parla con next-intl.
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

/** Disegna davvero una sezione della home e la restituisce dentro un contenitore. */
async function disegna(sezione: { id: string; type: string; config: Record<string, unknown> }): Promise<HTMLDivElement> {
  const { default: HomeSectionRenderer } = await import('@/components/home-sections/HomeSectionRenderer');
  const html = renderToStaticMarkup(
    createElement(HomeSectionRenderer, {
      sections: [sezione] as never,
      heroVariant: 'a',
      heroDefaults: { eyebrow: 'x', headline: 'x', subhead: 'x', ctaPrimary: 'x' } as never,
    }),
  );
  const contenitore = document.createElement('div');
  contenitore.innerHTML = html;
  return contenitore;
}

async function fasciaVenditori(): Promise<HTMLAnchorElement | null> {
  const contenitore = await disegna({ id: 'venditori', type: 'sellerCta', config: {} });
  return Array.from(contenitore.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('Diventa venditore')) ?? null;
}

const classiDi = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

describe('R10-002 · la fascia «Diventa venditore» non allarga la home sul telefono', () => {
  it('il pulsante può andare a capo e resta dentro la larghezza dello schermo', async () => {
    const pulsante = await fasciaVenditori();
    expect(pulsante, 'la fascia per i negozi non ha più il pulsante «Diventa venditore»').not.toBeNull();
    const classi = (pulsante!.getAttribute('class') ?? '').split(/\s+/);
    expect(classi, 'con «whitespace-nowrap» la riga del pulsante non va a capo e col testo grande esce dallo schermo').not.toContain('whitespace-nowrap');
    expect(classi, 'il pulsante deve restare dentro la larghezza di chi lo contiene').toContain('max-w-full');
  });

  /*
   * Seconda passata (revisore, Chromium a 360 px col testo al 200%): tolto il nowrap la home arrivava
   * ancora a 401 px. Nel riquadro «Perché scegliere MyCity» il testo accanto all'icona fissa
   * (`w-10 shrink-0`) non poteva stringersi (un elemento flessibile non scende sotto la parola più
   * lunga) né andare a capo dentro la parola: «Commercianti locali» usciva dallo schermo.
   */
  it('nel riquadro «Perché scegliere MyCity» il testo accanto all’icona si stringe e va a capo', async () => {
    const radice = await disegna({ id: 'fiducia', type: 'liveActivity', config: {} });
    const titolo = Array.from(radice.querySelectorAll('h3')).find((h) => (h.textContent ?? '').includes('Perché scegliere MyCity'));
    expect(titolo, 'il riquadro «Perché scegliere MyCity» non c’è più: la prova girerebbe a vuoto').toBeTruthy();
    const righe = Array.from(titolo!.parentElement!.querySelectorAll('li'));
    expect(righe.map((li) => li.textContent ?? '').join(' | ')).toContain('Commercianti locali');
    for (const riga of righe) {
      const testo = Array.from(riga.children).find((figlio) => !classiDi(figlio).includes('shrink-0'));
      expect(testo, `«${riga.textContent}»: manca il testo accanto all’icona`).toBeTruthy();
      const classi = classiDi(testo!);
      expect(classi, `«${testo!.textContent}»: senza min-w-0 il testo non scende sotto la parola più lunga e col testo grande esce dallo schermo`).toContain('min-w-0');
      expect(classi, `«${testo!.textContent}»: senza break-words una parola più larga dello spazio non va a capo`).toContain('break-words');
    }
  });
});
