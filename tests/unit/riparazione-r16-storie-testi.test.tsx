/**
 * @vitest-environment jsdom
 */
/**
 * R16-007 — Nella schermata delle storie il negoziante trovava «Caption» e «/category/alimentari»
 * come esempio di link: una parola inglese e un indirizzo da programmatore.
 *
 * Qui si apre la finestra «Nuova storia» e si leggono le etichette: italiano semplice, e l'esempio
 * del link è uno che il salvataggio accetta davvero (la regola di R16-011, lib/safe-redirect.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { safeInternalPath } from '@/lib/safe-redirect';

vi.mock('@/lib/supabase/client', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) q[m] = () => q;
  q.limit = async () => ({ data: [], error: null });
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) }, from: () => q } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { alt: String(p.alt ?? '') }) };
});

import SellerStoriesPage from '@/app/seller/stories/page';

const accesi: Root[] = [];

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function apriNuovaStoria(): Promise<HTMLElement> {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerStoriesPage))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  await act(async () => { screen.getByRole('button', { name: /Nuova storia/ }).click(); });
  return screen.getByRole('dialog');
}

describe('R16-007 · le etichette delle storie in italiano semplice', () => {
  it('la frase sotto la foto non si chiama più «Caption»', async () => {
    const dialogo = await apriNuovaStoria();
    expect(dialogo.textContent).not.toMatch(/caption/i);
    expect(dialogo.querySelector('textarea')?.labels?.[0]?.textContent).toMatch(/Scritta sotto la foto/);
  });

  it('il link si chiama «Pagina del sito» e il suo esempio è un link che il salvataggio accetta', async () => {
    const dialogo = await apriNuovaStoria();
    const campo = dialogo.querySelector('input:not([type="file"])') as HTMLInputElement;
    expect(campo.labels?.[0]?.textContent).toMatch(/Pagina del sito \(facoltativo\)/);
    expect(dialogo.textContent).not.toContain('/category/alimentari');
    const esempio = campo.getAttribute('placeholder') ?? '';
    expect(esempio).not.toBe('');
    expect(safeInternalPath(esempio, '')).toBe(esempio);
    expect(dialogo.textContent).toContain('Scopri di più');
  });
});
