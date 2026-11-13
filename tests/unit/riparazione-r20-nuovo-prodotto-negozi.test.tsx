// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R20-018 — Nel nuovo prodotto dell'amministrazione, se l'elenco dei negozi non arriva la
 * tendina non resta vuota e attiva senza spiegazioni: c'è un avviso con «Riprova»; e se i
 * negozi non ci sono, la pagina lo dice.
 */
const mondo = vi.hoisted(() => ({ negozi: 'giu' as 'giu' | 'vuoti' | 'ok', letture: 0 }));

vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/components/seller/ProductForm', () => ({ default: () => createElement('div', { 'data-form': '1' }) }));
vi.mock('@/components/products/ImportFromUrlBox', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) c[m] = () => c;
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        let r: unknown = { data: [], error: null };
        if (tavola === 'profiles') {
          mondo.letture += 1;
          if (mondo.negozi === 'giu') r = { data: null, error: { message: 'Failed to fetch', code: '' } };
          else if (mondo.negozi === 'ok') r = { data: [{ id: 'n1', store_name: 'Pane Quotidiano', offers_express: false }], error: null };
        }
        return Promise.resolve(r).then(ok, ko);
      };
      return c;
    },
  },
}));

const { default: Pagina } = await import('@/app/admin/products/new/page');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))));
  for (let i = 0; i < 6; i++) await pausa();
}
beforeEach(() => { mondo.letture = 0; });
afterEach(async () => { await act(async () => root.unmount()); c.remove(); });

describe('R20-018 · nuovo prodotto: i negozi non arrivano', () => {
  it('lettura caduta: avviso con «Riprova», niente tendina attiva; il tasto rilegge e i negozi tornano', async () => {
    mondo.negozi = 'giu';
    await monta();
    expect(c.textContent).toMatch(/Non riesco a leggere l.elenco dei negozi/);
    expect(c.querySelector('select')).toBeNull();
    const riprova = Array.from(c.querySelectorAll('button')).find((b) => /riprova|retry/i.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(riprova).toBeTruthy();
    const prima = mondo.letture;
    mondo.negozi = 'ok';
    await act(async () => { riprova.click(); });
    for (let i = 0; i < 6; i++) await pausa();
    expect(mondo.letture).toBeGreaterThan(prima);
    expect(c.textContent).not.toMatch(/Non riesco a leggere/);
    expect(c.textContent).toContain('Pane Quotidiano');
    expect((c.querySelector('select') as HTMLSelectElement).disabled).toBe(false);
  });

  it('nessun negozio: la pagina lo dice e la tendina è spenta', async () => {
    mondo.negozi = 'vuoti';
    await monta();
    expect(c.textContent).toMatch(/nessun negozio/i);
    expect((c.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
  });
});
