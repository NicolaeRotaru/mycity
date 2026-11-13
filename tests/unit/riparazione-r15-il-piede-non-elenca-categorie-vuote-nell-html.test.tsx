import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R15-002 — il piede non mette in mostra categorie vuote, nemmeno nell'HTML del server.
 *
 * Il piede filtrava le categorie vuote solo nel browser, dopo la lettura delle «piene». Sul server
 * quella lettura non c'è: finché non arrivava si elencavano tutte, quindi l'HTML (quello che legge
 * Google, e il primo disegno) portava sempre le otto categorie di riserva, sette senza un prodotto.
 * Qui si disegna davvero il piede sul server, con un QueryClient vero, come fa il sito.
 */

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in', 'gt']) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

const { default: Footer } = await import('@/components/Footer');

const CATEGORIE = [
  { id: 'c-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null },
  { id: 'c-ele', slug: 'elettronica', name: 'Elettronica', parent_id: null },
  { id: 'c-gio', slug: 'giocattoli', name: 'Giocattoli', parent_id: null },
];

function piedeSulServer(prepara: (qc: QueryClient) => void): string {
  const qc = new QueryClient();
  prepara(qc);
  return renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Footer)));
}

const linkDiCategoria = (html: string) => html.match(/href="\/category\/[^"]+"/g) ?? [];

describe('R15-002 — il piede nell’HTML del server', () => {
  it('senza nessuna lettura non elenca le categorie di riserva (sette vuote): resta «Tutte le categorie»', () => {
    const html = piedeSulServer(() => {});
    expect(linkDiCategoria(html)).toEqual([]);
    expect(html).toContain('href="/categorie"');
  });

  it('con le sole categorie lette, senza sapere quali sono piene, non ne mette in mostra nessuna', () => {
    const html = piedeSulServer((qc) => qc.setQueryData(['categories', 'tree'], CATEGORIE));
    expect(linkDiCategoria(html)).toEqual([]);
    expect(html).toContain('href="/categorie"');
  });

  it('sapendo quali sono piene ma non ancora l’elenco, non ripiega sulla riserva', () => {
    const html = piedeSulServer((qc) => qc.setQueryData(['categories', 'con-prodotti'], ['c-ali']));
    expect(linkDiCategoria(html)).toEqual([]);
  });

  it('con l’elenco e le piene lette elenca solo quelle con qualcosa dentro', () => {
    const html = piedeSulServer((qc) => {
      qc.setQueryData(['categories', 'tree'], CATEGORIE);
      qc.setQueryData(['categories', 'con-prodotti'], ['c-ali']);
    });
    expect(linkDiCategoria(html)).toEqual(['href="/category/alimentari"']);
  });
});
