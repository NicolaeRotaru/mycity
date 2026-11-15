import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

/**
 * R15-008 — col testo ingrandito al massimo sul telefono le pagine pubbliche non scorrono di lato.
 *
 * Visto nel browser vero (Chrome a 360px, html{font-size:200%}) prima e dopo: il piede passava da
 * 432px a 360, /lavora-con-noi da 473 a 360, /returns da 399 a 360, /faq da 405 a 360. Qui la prova
 * leggera sulle classi che lo fanno: se tornano quelle di prima, la pagina torna a scorrere.
 */

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: true }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

const leggi = (p: string) => readFileSync(p, 'utf8');

describe('il piede (ogni pagina pubblica)', () => {
  it('sotto md le colonne non sono due fisse: larghe almeno 8rem, al massimo mezza riga', async () => {
    const { default: Footer } = await import('@/components/Footer');
    const html = renderToStaticMarkup(createElement(Footer));
    const griglia = html.match(/<footer[^>]*>\s*<div class="([^"]+)"/)?.[1] ?? '';
    expect(griglia).toContain('md:grid-cols-5');
    expect(griglia.split(/\s+/)).not.toContain('grid-cols-2');
    expect(griglia).toContain('grid-cols-[repeat(auto-fit,minmax(max(8rem,calc((100%_-_2rem)/2)),1fr))]');
  });

  it('il blocco del marchio occupa tutta la riga anche quando la colonna è una sola', async () => {
    const { default: Footer } = await import('@/components/Footer');
    const html = renderToStaticMarkup(createElement(Footer));
    expect(html).toContain('class="col-span-full md:col-span-1"');
    expect(html).not.toContain('col-span-2 md:col-span-1');
  });
});

describe('/lavora-con-noi', () => {
  const src = leggi('app/lavora-con-noi/page.tsx');
  it('i tre riquadri hanno meno margine sul telefono e possono stringersi', () => {
    expect(src).toContain('min-w-0 bg-white border border-cream-300 rounded-2xl p-4 sm:p-6 flex flex-col');
  });
  it('il testo del bottone va a capo invece di allargare il riquadro', () => {
    expect(src).toContain('inline-flex max-w-full items-center');
    expect(src).toContain('<span className="min-w-0 [overflow-wrap:anywhere]">{cta}</span>');
  });
  it('il titolo grande va a capo dentro una parola troppo lunga', () => {
    expect(src).toMatch(/<h1 className="[^"]*break-words hyphens-auto"/);
  });
});

describe('/returns — il riquadro «14 giorni di diritto di recesso»', () => {
  const src = leggi('app/returns/page.tsx');
  it('se il testo non sta accanto all’icona va sotto', () => {
    expect(src).toContain('rounded-2xl border border-cream-300 bg-white p-4 sm:p-6">\n        <div className="flex flex-wrap items-start gap-4">');
    expect(src).toContain('<div className="min-w-0 flex-1 basis-40">');
  });
});

describe('/faq — il bottone «Contattaci»', () => {
  const src = leggi('app/faq/page.tsx');
  it('il riquadro ha meno margine sul telefono e il bottone non esce', () => {
    expect(src).toContain('rounded-2xl px-4 py-8 sm:p-8 text-center');
    expect(src).toContain('inline-flex max-w-full items-center gap-2 bg-white text-primary-800 px-4 sm:px-6');
    expect(src).toContain('<span className="min-w-0 [overflow-wrap:anywhere]">Contattaci</span>');
  });
});
