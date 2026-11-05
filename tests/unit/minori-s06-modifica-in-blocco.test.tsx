/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { salvaProdottoTracciato, DaCompletare } from '@/lib/products/salvataggio-tracciato';

/**
 * S06 — La modifica in blocco dell'elenco prodotti.
 * 154: «0» o un prezzo illeggibile non si salvano e lo si dice; si contano solo i salvati;
 *      la porta di scrittura rifiuta un prezzo non maggiore di zero.
 * 182: un prodotto con taglie non offre la scorta in blocco.
 */
const stato = vi.hoisted(() => ({
  mutazioni: [] as { mutationFn: (a: unknown) => Promise<unknown> }[],
  salvati: [] as Record<string, unknown>[],
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/products/salva-dal-browser', () => ({
  salvaProdottoDalBrowser: async (a: Record<string, unknown>) => { stato.salvati.push(a); },
}));
const PRODOTTI = [
  { id: 'p1', name: 'Focaccia', price: 4, status: 'available', images: [], stock: 5, has_variants: false, categories: null },
  { id: 'p2', name: 'Maglietta', price: 15, status: 'available', images: [], stock: 6, has_variants: true, categories: null },
];
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useInfiniteQuery: () => ({
    data: { pages: [{ righe: PRODOTTI, totale: 2 }] }, isPending: false, isLoading: false, isError: false,
    hasNextPage: false, refetch: vi.fn(),
  }),
  useQuery: () => ({ data: {}, isLoading: false, isError: false }),
  useMutation: (o: { mutationFn: (a: unknown) => Promise<unknown> }) => {
    stato.mutazioni.push(o);
    return { mutate: vi.fn(), isPending: false };
  },
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: Elenco } = await import('@/app/seller/products/page');

async function apri() {
  stato.mutazioni = [];
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(createElement(Elenco)); });
  const bottone = [...div.querySelectorAll('button')].find((b) => /Modifica in blocco/.test(b.textContent ?? ''));
  await act(async () => { bottone?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  // L'ultima mutazione registrata col nome giusto: la modifica in blocco è la quarta useMutation.
  const blocco = stato.mutazioni.slice(-4)[3];
  return { div, root, blocco };
}

beforeEach(() => { stato.salvati = []; });

describe('154 — prezzi in blocco', () => {
  it('«0» non si salva e il messaggio nomina il prodotto', async () => {
    const { root, blocco } = await apri();
    await expect(blocco.mutationFn({ p1: { price: '0' } })).rejects.toThrow(/«Focaccia»/);
    expect(stato.salvati).toHaveLength(0);
    root.unmount();
  });
  it('«2,50 €» si legge 2,5 e si conta solo quello salvato', async () => {
    const { root, blocco } = await apri();
    const n = await blocco.mutationFn({ p1: { price: '2,50 €' }, p2: { price: '' } });
    expect(stato.salvati[0].payload).toEqual({ price: 2.5 });
    expect(n).toBe(1);
    root.unmount();
  });
  it('la porta di scrittura rifiuta un prezzo a zero', async () => {
    await expect(salvaProdottoTracciato({
      db: {} as never, prodottoId: 'p1', attoreId: 's1', origine: 'x', payload: { price: 0 }, scriviTraccia: () => {},
    })).rejects.toBeInstanceOf(DaCompletare);
  });
});

describe('182 — scorta in blocco e taglie', () => {
  it('il prodotto con taglie manda alla scheda, quello senza ha il campo', async () => {
    const { div, root } = await apri();
    expect(div.querySelector('[aria-label="Stock di Focaccia"]')).not.toBeNull();
    expect(div.querySelector('[aria-label="Stock di Maglietta"]')).toBeNull();
    expect(div.textContent).toMatch(/dalla scheda/);
    root.unmount();
  });
});
