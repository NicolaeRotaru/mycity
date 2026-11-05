/**
 * @vitest-environment jsdom
 */
/**
 * S09 — 116: cambiando account sullo stesso telefono la memoria delle letture si svuota.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({ ascolta: null as null | ((e: string, s: { user: { id: string } } | null) => void) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (e: string, s: { user: { id: string } } | null) => void) => {
        mondo.ascolta = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

import QueryProvider from '@/components/providers/QueryProvider';

describe('116 — la memoria delle letture e il cambio di account', () => {
  it('all\'uscita e all\'ingresso di un altro account gli ordini del negozio di prima spariscono', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    let client: QueryClient | null = null;
    const Spia = () => { client = useQueryClient(); return null; };
    const radice = document.createElement('div');
    const root = createRoot(radice);
    await act(async () => { root.render(createElement(QueryProvider, null, createElement(Spia))); });

    await act(async () => { mondo.ascolta!('SIGNED_IN', { user: { id: 'negozio-A' } }); });
    client!.setQueryData(['seller', 'orders'], ['ordine di A']);
    await act(async () => { mondo.ascolta!('TOKEN_REFRESHED', { user: { id: 'negozio-A' } }); });
    expect(client!.getQueryData(['seller', 'orders'])).toEqual(['ordine di A']);

    await act(async () => { mondo.ascolta!('SIGNED_OUT', null); });
    expect(client!.getQueryData(['seller', 'orders'])).toBeUndefined();

    client!.setQueryData(['seller', 'orders'], ['ordine di A']);
    await act(async () => { mondo.ascolta!('SIGNED_IN', { user: { id: 'negozio-A' } }); });
    await act(async () => { mondo.ascolta!('SIGNED_IN', { user: { id: 'negozio-B' } }); });
    expect(client!.getQueryData(['seller', 'orders'])).toBeUndefined();
    act(() => root.unmount());
  });
});
