// @vitest-environment jsdom
/**
 * R24-005 / R24-015 — Nelle pagine del venditore un prodotto senza foto chiedeva il segnaposto a
 * placehold.co (sito esterno, due colori fuori palette). Ora è la foto di ripiego locale.
 * Qui le pagine VERE, con un prodotto senza foto: si legge il src dell'immagine.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const PRODOTTI = [
  { id: 'p1', name: 'Focaccia', price: 4, status: 'available', images: null, stock: 5, has_variants: false, categories: null },
];
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never) }));
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useInfiniteQuery: () => ({
    data: { pages: [{ righe: PRODOTTI, totale: 1 }] }, isPending: false, isLoading: false, isError: false,
    hasNextPage: false, refetch: vi.fn(),
  }),
  useQuery: () => ({ data: PRODOTTI, isLoading: false, isError: false, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: Elenco } = await import('@/app/seller/products/page');
const { default: FeaturedProductsPicker } = await import('@/components/seller/FeaturedProductsPicker');

async function srcDelleFoto(el: ReturnType<typeof createElement>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(el); });
  const src = [...div.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
  root.unmount();
  return src;
}

describe('R24-005/015 — la foto mancante del venditore è quella nostra', () => {
  it('elenco prodotti: tabella e schede usano /foto-mancante.svg, niente sito esterno', async () => {
    const src = await srcDelleFoto(createElement(Elenco));
    expect(src.length).toBeGreaterThan(0);
    for (const s of src) {
      expect(s).not.toMatch(/placehold/);
      expect(s).toContain('/foto-mancante.svg');
    }
  });
  it('selezione dei prodotti in evidenza: stessa foto di ripiego', async () => {
    const src = await srcDelleFoto(createElement(FeaturedProductsPicker, { value: [], onChange: () => {} }));
    expect(src.length).toBeGreaterThan(0);
    for (const s of src) {
      expect(s).not.toMatch(/placehold/);
      expect(s).toContain('/foto-mancante.svg');
    }
  });
});
