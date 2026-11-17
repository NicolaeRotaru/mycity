// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * La striscia «Eventi a Piacenza» in home scriveva la data dell'evento nel
 * fuso di chi guarda (browser, o server col fuso di Greenwich), non in quello
 * di Piacenza. Un evento che parte alle 00:30 del 6 novembre a Piacenza
 * (23:30 del 5 a Greenwich) compariva «5 nov».
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENTO = {
  id: 'e1',
  title: 'Sagra del tortello',
  description: null,
  cover_image_url: null,
  // 00:30 del 6 novembre a Piacenza; finisce alle 00:15 dell'8.
  starts_at: '2026-11-05T23:30:00Z',
  ends_at: '2026-11-07T23:15:00Z',
  discount_percent: null,
  cta_url: null,
};

vi.mock('@/lib/supabase/client', () => {
  const catena: Record<string, unknown> = {};
  for (const passo of ['select', 'in', 'or', 'order', 'limit']) catena[passo] = () => catena;
  catena.then = (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [EVENTO], error: null }).then(ok, ko);
  return { supabase: { from: () => catena } };
});
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children?: ReactNode; className?: string }) =>
    createElement('a', { href, className }, children),
}));

let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
});

describe('la data degli eventi in home è quella di Piacenza', () => {
  it('un evento delle 00:30 del 6 a Piacenza dice «6 nov», anche col fuso di Greenwich', async () => {
    process.env.TZ = 'UTC';
    // Orologio finto poco prima della mezzanotte di Greenwich: a Piacenza è già il giorno dopo.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T23:40:00Z'));

    const { default: HomeEvents } = await import('@/components/home/HomeEvents');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(QueryClientProvider, { client }, createElement(HomeEvents)));
    });
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    chiudi = () => {
      act(() => root?.unmount());
      host.remove();
      client.clear();
    };

    expect(host.textContent).toContain('Sagra del tortello');
    expect(host.textContent, 'la data è quella di Greenwich, non di Piacenza').toContain('6 nov – 8 nov');
    expect(host.textContent).not.toContain('5 nov');
  });
});
