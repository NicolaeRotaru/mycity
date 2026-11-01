import { it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 1/11/2026 — LA VETRINA DELLE CATEGORIE ESCE PIENA NELL'HTML DEL SERVER.
 *
 * Il server precarica solo le categorie, non l'elenco delle categorie «piene» (con almeno un
 * prodotto). Se la vetrina aspetta anche quella seconda lettura, nell'HTML del server escono gli
 * scheletri: Google e il primo disegno non vedono nessuna tessera. Qui si disegna davvero sul
 * server, con un QueryClient vero e le sole categorie precaricate, come fa la home.
 */

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in']) q[m] = () => q;
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

it('con le sole categorie precaricate la vetrina mostra le tessere, non gli scheletri', async () => {
  const { domandaCategoriePubbliche } = await import('@/lib/queries/categorie-pubbliche');
  const { default: CategoryShowcase } = await import('@/components/CategoryShowcase');
  const { supabase } = await import('@/lib/supabase/client');
  const qc = new QueryClient();
  qc.setQueryData(domandaCategoriePubbliche(supabase as never).queryKey, [
    { id: 'c-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null },
  ]);
  const html = renderToString(createElement(QueryClientProvider, { client: qc }, createElement(CategoryShowcase)));
  expect(html).not.toContain('aria-busy="true"');
  expect(html).toContain('/category/alimentari');
});

it('con le sole categorie precaricate il piede le elenca, non resta senza categorie', async () => {
  const { default: Footer } = await import('@/components/Footer');
  const qc = new QueryClient();
  qc.setQueryData(['categories', 'tree'], [{ id: 'c-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null }]);
  const html = renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Footer)));
  expect(html).toContain('/category/alimentari');
});

it('quando anche le piene sono lette, vetrina e piede tolgono le categorie vuote', async () => {
  const { domandaCategoriePubbliche } = await import('@/lib/queries/categorie-pubbliche');
  const { default: CategoryShowcase } = await import('@/components/CategoryShowcase');
  const { default: Footer } = await import('@/components/Footer');
  const { supabase } = await import('@/lib/supabase/client');
  const categorie = [
    { id: 'c-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null },
    { id: 'c-ele', slug: 'elettronica', name: 'Elettronica', parent_id: null },
  ];
  const qc = new QueryClient();
  qc.setQueryData(domandaCategoriePubbliche(supabase as never).queryKey, categorie);
  qc.setQueryData(['categories', 'tree'], categorie);
  qc.setQueryData(['categories', 'con-prodotti'], ['c-ali']);
  for (const pezzo of [CategoryShowcase, Footer]) {
    const html = renderToString(createElement(QueryClientProvider, { client: qc }, createElement(pezzo)));
    expect(html).toContain('/category/alimentari');
    expect(html).not.toContain('/category/elettronica');
  }
});
