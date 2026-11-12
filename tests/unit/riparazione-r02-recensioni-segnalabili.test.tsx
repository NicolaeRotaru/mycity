/**
 * @vitest-environment jsdom
 *
 * R02-005 (12/11/2026) — Ogni recensione della vetrina si può segnalare (tipo «recensione»): i
 * Termini promettono di togliere quelle non genuine.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const segnalabili: Array<{ tipo: string; oggettoId: string }> = [];

vi.mock('@/components/Segnala', () => ({
  Segnala: (p: { tipo: string; oggettoId: string }) => {
    segnalabili.push(p);
    return createElement('button', { 'data-segnala': p.tipo }, 'Segnala questo contenuto');
  },
}));
vi.mock('@/components/hooks/useUtente', () => ({ useUtente: () => ({ userId: null }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'in', 'eq']) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return { supabase: c };
});

import ReviewsSection from '@/components/store-sections/ReviewsSection';

const recensione = (id: string) => ({
  id, rating: 5, comment: 'Ottimo pane', created_at: '2026-11-01', seller_reply: null,
  user_id: null, order_id: null, photo_urls: null, helpful_count: 0, author: null,
});

describe('R02-005 · le recensioni si possono segnalare', () => {
  it('ogni recensione mostrata ha il suo «Segnala» di tipo recensione', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const ctx = { reviews: [recensione('rv-1'), recensione('rv-2')], accent: '#7A8B3C', recensioniInErrore: false, riepilogoRecensioni: null };
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ReviewsSection, { ctx: ctx as never })));
    });
    expect(box.querySelectorAll('[data-segnala="recensione"]')).toHaveLength(2);
    expect(segnalabili.map((s) => s.oggettoId).sort()).toEqual(['rv-1', 'rv-2']);
    act(() => root.unmount());
  });
});
