/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 31/10/2026 (ondata 6) — AI NEGOZI DICIAMO UN PREZZO SOLO, E AI CLIENTI COME SI PAGA DAVVERO.
 *
 * Il sito diceva ai negozianti cinque prezzi: «Vendi online con zero commissioni» in home, «Apri
 * gratis… Nessuna commissione mensile» nell'anteprima di /sell su Google e WhatsApp, «0€
 * commissioni mensili» in «Chi siamo», «Nessun costo mensile» nell'aiuto e nei guadagni, e
 * «Abbonamento €50/mese» nell'area venditori. Il prezzo firmato da Nicola il 26/10 è uno: niente
 * canone finché il negozio non incassa con MyCity, poi il 10% IVA inclusa solo sul venduto
 * tramite MyCity. E la FAQ dei clienti prometteva il «POS al rider», che non esiste.
 *
 * Qui si disegnano le pagine vere e si legge quello che il negoziante e il cliente leggono.
 * I nomi usati sono quelli che c'erano già: la frase attesa si ricostruisce dalla commissione
 * e dall'interruttore dell'abbonamento, non da una costante nuova.
 */

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => {
    throw new Error('la prova non legge la banca dati');
  },
}));
vi.mock('@/lib/cms', () => ({ loadPublishedCmsPage: async () => null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'cliente-1' },
    isAuthenticated: true,
    isLoading: false,
    isSeller: false,
    isAdmin: false,
    isBuyer: true,
    isRider: false,
  }),
}));
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));
vi.mock('@/components/home/HeroStoreCard', () => ({ default: () => null }));
vi.mock('@/components/home/HomeCtaLink', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('@/components/seller/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }));
vi.mock('@/components/seller/SellerShell', () => ({
  default: ({ children }: { children?: ReactNode }) => children,
}));

const testo = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** Le promesse che il prezzo firmato smentisce. */
const VIETATO = /zero commission|apri gratis|nessun costo mensile|nessuna commissione mensile|commissioni mensili/i;

async function attese() {
  const { COMMISSIONE_PERCENTO } = await import('@/app/seller/earnings/commissione');
  const { ABBONAMENTO_NEGOZI_ACCESO } = await import('@/lib/funzioni-al-lancio');
  const commissione = `${COMMISSIONE_PERCENTO}% solo su quello che vendi tramite MyCity, IVA inclusa`;
  const canone = ABBONAMENTO_NEGOZI_ACCESO ? 'Abbonamento €50/mese' : 'Nessun canone finché non incassi con MyCity';
  return { commissione, canone, acceso: ABBONAMENTO_NEGOZI_ACCESO };
}

async function diceIlPrezzoFirmato(t: string, dove: string) {
  const { commissione, canone, acceso } = await attese();
  expect(t, `${dove}: promette un prezzo che il negozio poi non trova`).not.toMatch(VIETATO);
  expect(t, `${dove}: manca il canone firmato`).toContain(canone);
  expect(t, `${dove}: manca la commissione firmata`).toContain(commissione);
  if (!acceso) expect(t, `${dove}: chiede 50 € al mese con l'abbonamento spento`).not.toMatch(/€\s?50\s?\/\s?mese|50\s?€\s?al mese/i);
}

describe('ai negozi diciamo un prezzo solo', () => {
  it('l’anteprima di /sell su Google, WhatsApp e X', async () => {
    const { metadata } = await import('@/app/sell/layout');
    const anteprime = [
      String(metadata.description),
      String(metadata.openGraph?.description),
      String(metadata.twitter?.description),
    ];
    for (const a of anteprime) await diceIlPrezzoFirmato(a, `anteprima «${a.slice(0, 40)}…»`);
  });

  it('la FAQ dei clienti, con le risposte aperte', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { default: FaqPage } = await import('@/app/faq/page');
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => {
      root.render(createElement(FaqPage));
    });
    const bottoni = [...box.querySelectorAll('button[aria-expanded="false"]')];
    expect(bottoni.length, 'la FAQ deve avere domande da aprire').toBeGreaterThan(5);
    for (const b of bottoni) {
      act(() => {
        b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }
    const t = (box.textContent ?? '').replace(/\s+/g, ' ');
    await diceIlPrezzoFirmato(t, 'FAQ «Quanto costa vendere?»');

    // Come si paga: quello che offre la cassa, niente «POS al rider» né carte «in arrivo».
    const { fraseComeSiPaga } = await import('@/lib/promesse-pubbliche');
    expect(t).toContain(fraseComeSiPaga());
    expect(t, 'la FAQ promette un POS al rider che non esiste').not.toMatch(/\bPOS\b/);
    expect(t, 'la FAQ promette metodi «in arrivo» che la cassa non offre').not.toMatch(/stiamo integrando|paypal/i);
    act(() => root.unmount());
  });

  it('«Chi siamo»: niente «0€ di commissioni mensili»', async () => {
    const { default: AboutPage } = await import('@/app/about/page');
    const { COMMISSIONE_PERCENTO } = await import('@/app/seller/earnings/commissione');
    const t = testo(renderToStaticMarkup(await AboutPage()));
    expect(t).not.toMatch(VIETATO);
    expect(t).not.toMatch(/(^|\s)0\s?€/);
    expect(t).toContain(`${COMMISSIONE_PERCENTO}% per i negozi`);
  });

  it('l’aiuto del venditore e la pagina dei guadagni', async () => {
    const { TOPICS } = await import('@/app/seller/help/domande');
    const risposta = TOPICS.flatMap((tp) => tp.items).find((i) => /quanto tratteniamo/i.test(String(i.q)));
    expect(risposta, 'l’aiuto deve rispondere a «Quanto tratteniamo?»').toBeDefined();
    await diceIlPrezzoFirmato(String(risposta?.a), 'aiuto «Quanto tratteniamo?»');

    const { spiegazioneCommissione, testoIntero } = await import('@/app/seller/earnings/commissione');
    const guadagni = spiegazioneCommissione().map(testoIntero).join(' ');
    const { canone } = await attese();
    expect(guadagni).not.toMatch(VIETATO);
    expect(guadagni).toContain(canone);
  });

  it('la fascia «Hai un negozio a Piacenza?» in home', async () => {
    const { default: HomeSectionRenderer } = await import('@/components/home-sections/HomeSectionRenderer');
    const t = testo(
      renderToStaticMarkup(
        createElement(HomeSectionRenderer, {
          sections: [{ id: 'venditori', type: 'sellerCta', config: {} }] as never,
          heroVariant: 'a',
          heroDefaults: { eyebrow: 'x', headline: 'x', subhead: 'x', ctaPrimary: 'x' } as never,
        }),
      ),
    );
    expect(t).toMatch(/Hai un negozio a Piacenza\?/);
    await diceIlPrezzoFirmato(t, 'fascia venditori in home');
  });

  it('l’area venditori vista da un cliente che vuole aprire un negozio', async () => {
    const { default: SellerLayout } = await import('@/app/seller/layout');
    const t = testo(renderToStaticMarkup(createElement(SellerLayout, null, createElement('p', null, 'dentro'))));
    expect(t).toMatch(/Quest'area è per i venditori/);
    await diceIlPrezzoFirmato(t, 'area venditori');
  });
});
