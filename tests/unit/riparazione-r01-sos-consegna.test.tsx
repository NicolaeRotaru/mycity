/**
 * @vitest-environment jsdom
 */
/**
 * R01-006 — La consolle SOS non mostrava da quale consegna parte l'allarme: `order_id` era
 * letto nella select e mai disegnato. Qui la pagina si monta davvero con un SOS aperto legato
 * a un ordine e uno senza ordine, e si guarda cosa compare.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const dati = vi.hoisted(() => ({
  elenco: [
    { id: 'a', rider_id: 'r1', order_id: '8f0c2b6e-1111-2222-3333-444455556666', lat: null, lng: null,
      triggered_at: '2026-11-12T10:00:00Z', resolved_at: null, resolution_note: null, rider: { full_name: 'Anna', phone: null } },
    { id: 'b', rider_id: 'r2', order_id: null, lat: null, lng: null,
      triggered_at: '2026-11-12T09:00:00Z', resolved_at: null, resolution_note: null, rider: { full_name: 'Bruno', phone: null } },
  ],
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: dati.elenco, isError: false, isLoading: false, isFetching: false, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: (p: { href: string; children: unknown; className?: string }) => createElement('a', { href: p.href, className: p.className }, p.children as never),
}));

import AdminSOSPage from '@/app/admin/sos/page';

const accesi: Root[] = [];
afterEach(() => { for (const r of accesi.splice(0)) act(() => r.unmount()); });

describe('R01-006 · la consolle SOS dice da quale consegna parte l\'allarme', () => {
  it('l\'SOS legato a un ordine mostra la consegna con il link all\'ordine', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    const root = createRoot(radice);
    accesi.push(root);
    await act(async () => { root.render(createElement(AdminSOSPage)); });
    const link = radice.querySelector<HTMLAnchorElement>('a[href="/admin/orders/8f0c2b6e-1111-2222-3333-444455556666"]');
    expect(link).not.toBeNull();
    expect(link?.textContent ?? '').toMatch(/Consegna #8f0c2b6e/);
    expect(radice.textContent).toMatch(/Fuori da una consegna/);
  });
});
