import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 31/10/2026 (ondata 3) — IL RESO DICE QUALI PRODOTTI SONO ESCLUSI, PRIMA DELL'ACQUISTO.
 *
 * Il sito prometteva «Reso entro 14 giorni» su ogni scheda e nel riepilogo della cassa, e la home e
 * «Come funziona» aggiungevano «Cambi idea? Ti rimborsiamo senza domande.», anche su pane e freschi.
 * L'art. 59 lett. d del Codice del Consumo esclude il ripensamento sui beni che si deteriorano in
 * fretta; l'art. 49 c.1 lett. m obbliga a dirlo prima dell'acquisto. Il primo negozio vero è un forno.
 *
 * Qui si disegnano i posti dove si legge la promessa — il piede, la fascia della fiducia in home,
 * «Come funziona», il riepilogo della cassa — e si legge il testo: l'esclusione c'è, il «senza
 * domande» no.
 */

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => {} }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));
vi.mock('@/components/home/HeroStoreCard', () => ({ default: () => null }));
vi.mock('@/components/home/HomeCtaLink', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));

const testo = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const SENZA_DOMANDE = /senza domande/i;
const RESO = /reso entro 14 giorni/i;
/** L'esclusione detta: freschi o deperibili, come esclusi o come «non su». */
const ESCLUSIONE = /(esclus|non su)[^.]{0,40}(fresc|deperibil|pane)/i;

/** Ogni volta che il testo nomina il reso, l'esclusione sta nella stessa frase o subito dopo. */
function ogniResoHaLaSuaEsclusione(t: string) {
  const volte = [...t.matchAll(/reso entro 14 giorni|cambi idea\?/gi)];
  expect(volte.length, 'la pagina deve parlare del reso (la prova disegna davvero quella riga)').toBeGreaterThan(0);
  for (const v of volte) {
    const dopo = t.slice(v.index ?? 0, (v.index ?? 0) + 160);
    expect(dopo, `«${dopo.slice(0, 60)}…» promette il reso senza dire chi è escluso`).toMatch(ESCLUSIONE);
  }
}

describe('la promessa del reso porta sempre l’esclusione dei freschi', () => {
  it('la frase unica del reso (scheda prodotto, accesso) nomina l’esclusione', async () => {
    // Solo il nome che c'era già: la spiegazione lunga si legge disegnata, nelle pagine sotto.
    const { FRASE_RESO } = await import('@/lib/promesse-pubbliche');
    expect(FRASE_RESO).toMatch(RESO);
    expect(FRASE_RESO).toMatch(ESCLUSIONE);
    expect(FRASE_RESO).not.toMatch(/gratuit/i);
  });

  it('il piede del sito', async () => {
    const { default: Footer } = await import('@/components/Footer');
    const t = testo(renderToStaticMarkup(createElement(Footer)));
    expect(t).toMatch(RESO);
    ogniResoHaLaSuaEsclusione(t);
  });

  it('la fascia della fiducia in home: niente «senza domande»', async () => {
    const { default: HomeSectionRenderer } = await import('@/components/home-sections/HomeSectionRenderer');
    const t = testo(
      renderToStaticMarkup(
        createElement(HomeSectionRenderer, {
          sections: [{ id: 'fiducia', type: 'trustRow', config: {} }] as never,
          heroVariant: 'a',
          heroDefaults: { eyebrow: 'x', headline: 'x', subhead: 'x', ctaPrimary: 'x' } as never,
        }),
      ),
    );
    expect(t).not.toMatch(SENZA_DOMANDE);
    ogniResoHaLaSuaEsclusione(t);
  });

  it('«Come funziona»: la pagina e la sua descrizione per Google', async () => {
    const pagina = await import('@/app/come-funziona/page');
    const t = testo(renderToStaticMarkup(createElement(pagina.default)));
    expect(t).not.toMatch(SENZA_DOMANDE);
    ogniResoHaLaSuaEsclusione(t);
    expect(pagina.metadata.description).toMatch(/reso entro 14 giorni sui prodotti non deperibili/i);
  });

  it('il riepilogo della cassa, l’ultimo schermo prima di confermare', async () => {
    const { OrderSummary } = await import('@/components/checkout/OrderSummary');
    const t = testo(
      renderToStaticMarkup(
        createElement(OrderSummary, {
          subtotal: 20,
          pickupDiscount: 0,
          couponDiscount: 0,
          total: 23,
          shipping: 0,
          platformDeliveryFee: 3,
          isCheckingOut: false,
          paymentMethod: 'cod',
        } as never),
      ),
    );
    expect(t).toMatch(RESO);
    ogniResoHaLaSuaEsclusione(t);
  });
});
