/**
 * @vitest-environment jsdom
 *
 * R11-004 — Una lista creata da /lists deve far rileggere anche le liste del menu «Aggiungi a lista»
 * (chiave `lists.mineMin`), non solo quelle della pagina.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

vi.mock('@/lib/supabase/client', () => {
  const lettura = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
      from: () => ({
        ...lettura(),
        select: () => lettura(),
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'l-1' }, error: null }) }) }),
      }),
    },
  };
});
vi.mock('@/lib/queries/profili-pubblici', () => ({ conAutoriPubblici: async (x: unknown) => x }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));
vi.mock('@/components/CollectionHeader', () => ({ default: () => null }));

import Pagina from '@/app/lists/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const attesa = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('R11-004 lista creata e menu «Aggiungi a lista»', () => {
  it('dopo la creazione le liste del menu risultano da rileggere', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Il menu ha già letto le sue liste (vuote): sono in cache, fresche.
    qc.setQueryData(queryKeys.lists.mineMin, []);
    expect(qc.getQueryState(queryKeys.lists.mineMin)?.isInvalidated).toBe(false);

    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
    await attesa(50);
    const apri = [...document.querySelectorAll('button')].find((b) => /Nuova lista|Crea la prima lista/.test(b.textContent ?? ''));
    await act(async () => { apri!.click(); });
    await attesa(60);
    const titolo = document.querySelector('input[placeholder^="I miei essenziali"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(titolo, 'Colazione');
      titolo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const crea = [...document.querySelectorAll('button')].find((b) => /^Crea lista$/.test((b.textContent ?? '').trim()))!;
    await act(async () => { crea.click(); });
    await attesa(80);

    expect(qc.getQueryState(queryKeys.lists.mineMin)?.isInvalidated).toBe(true);
    act(() => root.unmount());
    box.remove();
  });
});
