// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

/**
 * S10 (5/11/2026, scheda 531) — dopo «Esci» la memoria dei dati scaricati si
 * svuota: chi viene dopo non vede nome e ultimi acquisti di chi è uscito.
 */

const ascolti: Array<(e: string, s: { user?: { id: string } } | null) => void> = [];
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        ascolti.push(cb as never);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));

import QueryProvider from '@/components/providers/QueryProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('l\'uscita svuota i dati in memoria (531)', () => {
  it('SIGNED_OUT → la cache non ha più gli ordini di Maria; un altro SIGNED_IN la svuota', async () => {
    let qc: QueryClient | null = null;
    const Presa = () => {
      qc = useQueryClient();
      return null;
    };
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => root.render(createElement(QueryProvider, null, createElement(Presa))));
    act(() => ascolti.forEach((a) => a('INITIAL_SESSION', { user: { id: 'maria' } })));
    qc!.setQueryData(['ordini', 'maria'], [{ id: 'o-1' }]);
    act(() => ascolti.forEach((a) => a('SIGNED_OUT', null)));
    expect(qc!.getQueryData(['ordini', 'maria'])).toBeUndefined();

    act(() => ascolti.forEach((a) => a('SIGNED_IN', { user: { id: 'luca' } })));
    qc!.setQueryData(['ordini', 'luca'], [{ id: 'o-2' }]);
    act(() => ascolti.forEach((a) => a('SIGNED_IN', { user: { id: 'luca' } }))); // rinnovo: niente
    expect(qc!.getQueryData(['ordini', 'luca'])).toBeDefined();
    act(() => ascolti.forEach((a) => a('SIGNED_IN', { user: { id: 'anna' } })));
    expect(qc!.getQueryData(['ordini', 'luca'])).toBeUndefined();
    await act(async () => root.unmount());
  });
});
