// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R20-017 — La pagina delle categorie, quando non ce n'è nessuna, non resta bianca: dice
 * «Nessuna categoria ancora». Con la lettura caduta dice che la lettura non è andata (già così).
 */
const mondo = vi.hoisted(() => ({ righe: [] as unknown[], errore: false }));

vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children }: { href: string; children?: unknown }) => ce('a', { href }, children as never) };
});
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({
      select: async () => (mondo.errore ? { data: null, error: { message: 'Failed to fetch' } } : { data: mondo.righe, error: null }),
    }),
  },
}));

const { default: Pagina } = await import('@/app/admin/categories/page');

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
afterEach(async () => { await act(async () => root.unmount()); c.remove(); });

describe('R20-017 · categorie: stato vuoto', () => {
  it('zero categorie: c è il messaggio di stato vuoto', async () => {
    mondo.errore = false; mondo.righe = [];
    await monta();
    expect(c.textContent).toContain('Nessuna categoria ancora');
    expect(c.textContent).not.toMatch(/Non riesco a leggere/);
  });

  it('con delle categorie il messaggio non c è', async () => {
    mondo.errore = false;
    mondo.righe = [{ id: 'c1', slug: 'pane', name: 'Pane', icon: null, parent_id: null, sort_order: 0, featured: false }];
    await monta();
    expect(c.textContent).not.toContain('Nessuna categoria ancora');
    expect((c.querySelector('input[value="Pane"]'))).not.toBeNull();
  });

  it('lettura caduta: lo dice, non dice «nessuna categoria»', async () => {
    mondo.errore = true;
    await monta();
    expect(c.textContent).toMatch(/Non riesco a leggere le categorie/);
    expect(c.textContent).not.toContain('Nessuna categoria ancora');
  });
});
