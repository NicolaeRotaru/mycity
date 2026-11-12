import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R07-023 (12/11/2026) — il pulsante del banner della vetrina poteva puntare a un prodotto
 * scelto quando era in vendita e poi messo in bozza: il cliente non riusciva ad aprirlo.
 * La scelta di una bozza era già bloccata (343); restava il prodotto messo in bozza DOPO.
 *  · la vetrina chiede `prodotto_in_vetrina` e, se risponde no, il pulsante non c'è;
 *  · il costruttore della vetrina avvisa il negozio che il prodotto scelto non è in vendita.
 */
const stato = vi.hoisted(() => ({ lettura: {} as Record<string, unknown>, chiavi: [] as unknown[] }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }), usePathname: () => '/seller/site', useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children?: ReactNode }) => createElement('a', { href, ...r }, children) }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: (o: { queryKey: unknown[] }) => { stato.chiavi.push(o.queryKey); return stato.lettura; },
}));

const { default: BannerSection } = await import('@/components/store-sections/BannerSection');
const { default: BannerFields } = await import('@/components/seller/site/BannerFields');

const ctx = { storeId: 'negozio-1', accent: '#C0492C', site: { theme: 'classico', pages: [] } } as never;
const config = (productId: string) =>
  ({ imageUrl: 'https://x/y.jpg', heading: 'Saldi', cta: { label: 'Scopri', target: { kind: 'product', productId } } }) as never;

beforeEach(() => { stato.chiavi = []; });

describe('R07-023 · la vetrina: niente pulsante verso un prodotto che non è più in vetrina', () => {
  it('il database dice che il prodotto non è in vetrina: il pulsante non c è', () => {
    stato.lettura = { data: false, isError: false };
    const html = renderToStaticMarkup(createElement(BannerSection, { config: config('p-bozza'), ctx }));
    expect(stato.chiavi).toContainEqual(['prodotto-in-vetrina', 'p-bozza']);
    expect(html).not.toContain('Scopri');
  });

  it('il prodotto è in vetrina: il pulsante c è', () => {
    stato.lettura = { data: true, isError: false };
    const html = renderToStaticMarkup(createElement(BannerSection, { config: config('p-ok'), ctx }));
    expect(html).toContain('Scopri');
  });

  it('se la domanda non riesce il pulsante resta (non si decide al buio)', () => {
    stato.lettura = { data: undefined, isError: true };
    const html = renderToStaticMarkup(createElement(BannerSection, { config: config('p-ok'), ctx }));
    expect(html).toContain('Scopri');
  });
});

describe('R07-023 · l HTML del server non porta il link prima della risposta', () => {
  it('risposta non ancora arrivata (come sul server): niente pulsante verso il prodotto', () => {
    stato.lettura = { data: undefined, isError: false, isPending: true };
    const html = renderToStaticMarkup(createElement(BannerSection, { config: config('p-bozza'), ctx }));
    expect(html).not.toContain('/product/p-bozza');
  });

  it('un pulsante verso una categoria non aspetta nessuna risposta', () => {
    stato.lettura = { data: undefined, isError: false, isPending: true };
    const cfg = { imageUrl: 'https://x/y.jpg', cta: { label: 'Scopri', target: { kind: 'category', categorySlug: 'pane' } } } as never;
    expect(renderToStaticMarkup(createElement(BannerSection, { config: cfg, ctx }))).toContain('Scopri');
  });
});

describe('R07-023 · il costruttore avvisa il negozio', () => {
  it('il prodotto scelto è passato in bozza: il negozio lo legge', () => {
    stato.lettura = { data: [{ id: 'p2', name: 'Torta', status: 'draft' }], isLoading: false, isError: false, refetch: vi.fn() };
    const sezione = { id: 'b1', type: 'banner', config: { cta: { label: 'Scopri', target: { kind: 'product', productId: 'p2' } } } } as never;
    const html = renderToStaticMarkup(createElement(BannerFields, { section: sezione, onChange: () => {} }));
    expect(html).toMatch(/«Torta» non è in vendita/);
  });

  it('il prodotto scelto è in vendita: nessun avviso', () => {
    stato.lettura = { data: [{ id: 'p1', name: 'Pane', status: 'available' }], isLoading: false, isError: false, refetch: vi.fn() };
    const sezione = { id: 'b1', type: 'banner', config: { cta: { label: 'Scopri', target: { kind: 'product', productId: 'p1' } } } } as never;
    const html = renderToStaticMarkup(createElement(BannerFields, { section: sezione, onChange: () => {} }));
    expect(html).not.toMatch(/non è in vendita/);
  });
});
