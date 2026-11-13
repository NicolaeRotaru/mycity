/**
 * @vitest-environment jsdom
 */
/**
 * R01-009 — La consolle leggeva solo gli ultimi 50 SOS. Con cinquanta eventi piu' recenti gia'
 * risolti, un'emergenza aperta piu' vecchia restava fuori e la pagina diceva «Tutto tranquillo».
 *
 * Qui la pagina si monta con react-query vero e un database finto che si comporta come quello
 * vero: `limit(50)` taglia davvero, `is('resolved_at', null)` filtra davvero.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = { id: string; rider_id: string; order_id: null; lat: null; lng: null; triggered_at: string;
  resolved_at: string | null; resolution_note: null; rider: { full_name: string; phone: null } };

const db = vi.hoisted(() => ({ righe: [] as Riga[] }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => {
      let righe = [...db.righe];
      const q = {
        select: () => q,
        is: (c: string, v: unknown) => { righe = righe.filter((r) => (r as Record<string, unknown>)[c] === v); return q; },
        order: () => { righe.sort((a, b) => b.triggered_at.localeCompare(a.triggered_at)); return q; },
        limit: (n: number) => Promise.resolve({ data: righe.slice(0, n), error: null }),
      };
      return q;
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({ default: (p: { children: unknown }) => p.children }));

import AdminSOSPage from '@/app/admin/sos/page';

const accesi: Root[] = [];
afterEach(() => { for (const r of accesi.splice(0)) act(() => r.unmount()); });

function riga(i: number, risolto: boolean, nome = `Rider ${i}`): Riga {
  const quando = new Date(Date.UTC(2026, 10, 12, 0, 0, 0) + i * 60_000).toISOString();
  return { id: `s${i}`, rider_id: `r${i}`, order_id: null, lat: null, lng: null, triggered_at: quando,
    resolved_at: risolto ? quando : null, resolution_note: null, rider: { full_name: nome, phone: null } };
}

describe('R01-009 · un SOS aperto piu\' vecchio dei cinquanta piu\' recenti resta fra gli attivi', () => {
  it('con 50 SOS recenti risolti e uno vecchio aperto, la consolle non dice «tutto tranquillo»', async () => {
    db.righe = [riga(0, false, 'Carla in pericolo'), ...Array.from({ length: 50 }, (_, i) => riga(i + 1, true))];
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    const root = createRoot(radice);
    accesi.push(root);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(AdminSOSPage)));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(radice.textContent).toMatch(/Attivi \(1\)/);
    expect(radice.textContent).toMatch(/Carla in pericolo/);
    expect(radice.textContent).not.toMatch(/Tutto tranquillo/);
    client.clear();
  });
});
