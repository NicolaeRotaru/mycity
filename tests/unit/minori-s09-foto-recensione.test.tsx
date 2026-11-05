/**
 * @vitest-environment jsdom
 */
/**
 * S09 — Caricamento delle foto di una recensione (components/PhotoReviewUpload.tsx).
 *  101 — se la seconda foto fallisce, la prima (già caricata) entra comunque nella recensione;
 *  658 — il campo file si raggiunge da tastiera e ha un nome;
 *  287 — con i punti spenti non si promettono i +20 punti.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const mondo = vi.hoisted(() => ({ chiamate: 0 }));

vi.mock('@/lib/supabase/client', () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { src: String(p.src), alt: String(p.alt ?? '') }) };
});
vi.mock('@/lib/storage/carica-immagine', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage/carica-immagine')>()),
  caricaImmagine: async () => {
    mondo.chiamate += 1;
    if (mondo.chiamate === 2) throw new Error('network down');
    return { percorso: `u/p/foto-${mondo.chiamate}.jpg`, publicUrl: `https://foto/${mondo.chiamate}.jpg` };
  },
}));

import PhotoReviewUpload from '@/components/PhotoReviewUpload';

beforeEach(() => { mondo.chiamate = 0; });

async function monta(onUploaded: (u: string[]) => void) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  await act(async () => {
    root.render(createElement(PhotoReviewUpload, { userId: 'u', productId: 'p', onUploaded }));
  });
  return { radice, smonta: () => act(() => root.unmount()) };
}

describe('PhotoReviewUpload', () => {
  it('101 — la foto già caricata non sparisce se la successiva fallisce', async () => {
    const ricevute: string[][] = [];
    const g = await monta((u) => ricevute.push(u));
    const input = g.radice.querySelector('input[type="file"]') as HTMLInputElement;
    const file = (n: string) => new File(['x'], n, { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file('a.jpg'), file('b.jpg')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(ricevute.at(-1)).toEqual(['https://foto/1.jpg']);
    expect(g.radice.querySelectorAll('button[aria-label="Rimuovi"]').length).toBe(1);
    g.smonta();
  });

  it('658 — il campo file non è display:none e ha un nome', async () => {
    const g = await monta(() => {});
    const input = g.radice.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.className).not.toMatch(/\bhidden\b/);
    expect(input.className).toContain('sr-only');
    expect(input.getAttribute('aria-label')).toMatch(/Aggiungi foto alla recensione/);
    g.smonta();
  });

  it('287 — con i punti spenti non promette +20 punti', async () => {
    const g = await monta(() => {});
    expect(g.radice.textContent).not.toMatch(/punti/i);
    g.smonta();
  });
});
