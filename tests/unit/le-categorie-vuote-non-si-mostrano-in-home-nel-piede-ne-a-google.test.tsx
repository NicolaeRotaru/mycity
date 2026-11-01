import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 1/11/2026 — LE CATEGORIE VUOTE NON SI METTONO IN MOSTRA.
 *
 * Delle nove categorie principali solo Alimentari aveva prodotti: la home ne mostrava cinque
 * vuote su sei, il piede otto su nove, e ogni pagina di categoria vuota era indicizzabile da
 * Google. Qui si disegnano davvero la vetrina in home e il piede, e si chiedono i metadati della
 * pagina di categoria, contro dati finti: Alimentari ha un prodotto (in una sottocategoria),
 * Abbigliamento ed Elettronica no.
 */

type Risposta = { data?: unknown; isLoading?: boolean; isError?: boolean };

const mondo = vi.hoisted(() => ({
  risposte: {} as Record<string, Risposta>,
  categorie: [
    { id: 'c-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null },
    { id: 'c-forno', slug: 'forno', name: 'Forno', parent_id: 'c-ali' },
    { id: 'c-abb', slug: 'abbigliamento', name: 'Abbigliamento', parent_id: null },
    { id: 'c-ele', slug: 'elettronica', name: 'Elettronica', parent_id: null },
  ],
  prodotti: [{ id: 'p-focaccia', category_id: 'c-forno' }] as { id: string; category_id: string }[],
  erroreProdotti: false,
  categoriaLetta: null as null | Record<string, string>,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly string[] }) => {
    const r = mondo.risposte[o.queryKey.join('/')] ?? {};
    return { data: r.data, isLoading: !!r.isLoading, isError: !!r.isError };
  },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
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

// La pagina di categoria: la riga della categoria e le letture anonime per sapere se è piena.
vi.mock('@/lib/supabase/lettura-per-metadati', () => ({
  leggiPerMetadati: async () => mondo.categoriaLetta,
}));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    from: (tabella: string) => {
      const filtri: { in?: string[] } = {};
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'is']) q[m] = () => q;
      q.in = (_c: string, valori: string[]) => { filtri.in = valori; return q; };
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        let risposta: { data: unknown; error: unknown };
        if (tabella === 'products') {
          risposta = mondo.erroreProdotti
            ? { data: null, error: { message: 'rete' } }
            : { data: mondo.prodotti.filter((p) => !filtri.in || filtri.in.includes(p.category_id)), error: null };
        } else {
          risposta = { data: mondo.categorie, error: null };
        }
        return Promise.resolve(risposta).then(ok, ko);
      };
      return q;
    },
  }),
}));

const madri = () => mondo.categorie.filter((c) => c.parent_id === null);

beforeEach(() => {
  mondo.erroreProdotti = false;
  mondo.categoriaLetta = null;
  mondo.risposte = {
    categories: { data: madri() },
    'categories/tree': { data: mondo.categorie },
    'categories/con-prodotti': { data: ['c-forno', 'c-ali'] },
  };
});

describe('la vetrina delle categorie in home', () => {
  it('mostra solo le categorie con almeno un prodotto', async () => {
    const { default: CategoryShowcase } = await import('@/components/CategoryShowcase');
    const html = renderToStaticMarkup(createElement(CategoryShowcase));
    expect(html).toContain('/category/alimentari');
    expect(html).not.toContain('/category/abbigliamento');
    expect(html).not.toContain('/category/elettronica');
  });

  it('se la lettura delle categorie piene fallisce le mostra tutte, come prima', async () => {
    mondo.risposte['categories/con-prodotti'] = { isError: true };
    const { default: CategoryShowcase } = await import('@/components/CategoryShowcase');
    const html = renderToStaticMarkup(createElement(CategoryShowcase));
    expect(html).toContain('/category/abbigliamento');
  });
});

describe('il piede della pagina', () => {
  it('elenca solo le categorie con almeno un prodotto', async () => {
    const { default: Footer } = await import('@/components/Footer');
    const html = renderToStaticMarkup(createElement(Footer));
    expect(html).toContain('/category/alimentari');
    expect(html).not.toContain('/category/abbigliamento');
    expect(html).not.toContain('/category/elettronica');
    expect(html).toContain('href="/categorie"');
  });
});

describe('la pagina di una categoria', () => {
  it('vuota: dice a Google di non indicizzarla', async () => {
    mondo.categoriaLetta = { id: 'c-abb', slug: 'abbigliamento', name: 'Abbigliamento' };
    const { generateMetadata } = await import('@/app/category/[slug]/layout');
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'abbigliamento' }) });
    expect(meta.robots).toMatchObject({ index: false });
  });

  it('piena grazie a una sottocategoria: resta indicizzabile', async () => {
    mondo.categoriaLetta = { id: 'c-ali', slug: 'alimentari', name: 'Alimentari' };
    const { generateMetadata } = await import('@/app/category/[slug]/layout');
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'alimentari' }) });
    expect(meta.robots).toBeUndefined();
  });

  it('se non riesco a leggere i prodotti resta indicizzabile', async () => {
    mondo.erroreProdotti = true;
    mondo.categoriaLetta = { id: 'c-abb', slug: 'abbigliamento', name: 'Abbigliamento' };
    const { generateMetadata } = await import('@/app/category/[slug]/layout');
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'abbigliamento' }) });
    expect(meta.robots).toBeUndefined();
  });
});
