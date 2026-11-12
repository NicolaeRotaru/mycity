/**
 * @vitest-environment jsdom
 *
 * R02-023 (12/11/2026) — Vetrina del negozio al telefono:
 *  · il pannello nascosto non ha la classe `grid`, che vinceva sull'attributo hidden e lasciava
 *    «Info & orari» sotto ogni scheda;
 *  · la scheda «Recensioni · 0» dice «Ancora nessuna recensione» invece di restare vuota;
 *  · logo e nome restano sulla stessa riga, così il logo non sale sotto «Indietro».
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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

describe('R02-023 · la vetrina del negozio', () => {
  it('zero recensioni: lo dice', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const ctx = { reviews: [], accent: '#7A8B3C', recensioniInErrore: false, riepilogoRecensioni: { media: 0, totale: 0 } };
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ReviewsSection, { ctx: ctx as never })));
    });
    expect(box.textContent).toContain('Ancora nessuna recensione');
    act(() => root.unmount());
  });

  it('dopo il collaudo: mentre la lettura è in corso (conto non ancora arrivato, o 12 recensioni in arrivo) non dice «nessuna»', async () => {
    for (const riepilogo of [null, { media: 4.5, totale: 12 }]) {
      const box = document.createElement('div');
      document.body.appendChild(box);
      const root = createRoot(box);
      const ctx = { reviews: [], accent: '#7A8B3C', recensioniInErrore: false, riepilogoRecensioni: riepilogo };
      await act(async () => {
        root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ReviewsSection, { ctx: ctx as never })));
      });
      expect(box.textContent).not.toContain('Ancora nessuna recensione');
      act(() => root.unmount());
    }
  });

  it('il pannello nascosto non porta classi di impaginazione', () => {
    const src = readFileSync('components/store-sections/SectionRenderer.tsx', 'utf8');
    expect(src).toMatch(/className=\{t !== current \? 'hidden' :/);
  });

  it('logo e nome sulla stessa riga, il nome si stringe', () => {
    const src = readFileSync('components/store-sections/HeroSection.tsx', 'utf8');
    expect(src).toMatch(/absolute inset-x-0 bottom-0 z-10 flex flex-nowrap items-end/);
    expect(src).not.toMatch(/min-w-\[200px\] flex-1/);
  });
});
