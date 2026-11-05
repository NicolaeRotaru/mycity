/**
 * @vitest-environment jsdom
 */
/**
 * S09 — 231: il visore delle storie non si ferma da solo appena si apre, e «Riprendi» funziona.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const viste: string[] = [];
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (_n: string, a: { p_story: string }) => { viste.push(a.p_story); return Promise.resolve({}); } },
}));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { alt: String(p.alt ?? '') }) };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children }: Record<string, unknown>) => ce('a', { href: String(href) }, children as never) };
});

import StoryViewer from '@/components/StoryViewer';

const storia = (id: string) => ({
  id, seller_id: 's', image_url: 'https://x/y.jpg', caption: null, link_url: null, view_count: 0,
  expires_at: '2099-01-01', seller: { id: 's', store_name: 'Pane Quotidiano', store_logo: null },
});

afterEach(() => { vi.useRealTimers(); });

describe('231 — il visore delle storie', () => {
  it('appena aperto avanza da solo dopo 5 secondi (il fuoco messo dal codice non lo ferma)', async () => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => {
      root.render(createElement(StoryViewer, { stories: [storia('a'), storia('b')], onClose: () => {} }));
    });
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(radice.textContent).toContain('Storia 1 di 2');
    await act(async () => { vi.advanceTimersByTime(5100); });
    expect(radice.textContent).toContain('Storia 2 di 2');
    act(() => root.unmount());
  });

  it('«Metti in pausa» ferma e «Riprendi» fa ripartire, anche col fuoco dentro', async () => {
    vi.useFakeTimers();
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => {
      root.render(createElement(StoryViewer, { stories: [storia('c'), storia('d')], onClose: () => {} }));
    });
    const pausa = () => radice.querySelector('button[aria-pressed]') as HTMLButtonElement;
    await act(async () => { pausa().focus(); pausa().click(); });
    expect(pausa().getAttribute('aria-label')).toBe('Riprendi le storie');
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(radice.textContent).toContain('Storia 1 di 2');
    await act(async () => { pausa().click(); });
    expect(pausa().getAttribute('aria-label')).toBe('Metti in pausa le storie');
    await act(async () => { vi.advanceTimersByTime(5100); });
    expect(radice.textContent).toContain('Storia 2 di 2');
    act(() => root.unmount());
  });

  it('una visualizzazione per storia, anche fermando e riprendendo', () => {
    expect(viste.filter((v) => v === 'c')).toHaveLength(1);
  });
});
