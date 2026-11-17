// @vitest-environment jsdom
/**
 * R02-005 — Nel «Completa con» del carrello il prezzo (14 px) pesava meno del «+» (quadrato pieno
 * bg-primary-600): la stessa gerarchia rovesciata già chiusa in ProductCard. Qui la scheda
 * VERA del carrello: il prezzo è più grande del nome, il «+» è un contorno e resta di 44 punti.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: unknown }) => createElement('a', { href }, children as never) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/cart', () => ({ addToCart: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [{ id: 'p2', name: 'Grissini stirati', price: 3.2, images: [], seller_id: 's1', profiles: { store_name: 'Forno' } }] }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { CartUpsell } = await import('@/components/cart/CartUpsell');

async function striscia() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(createElement(CartUpsell, { items: [{ id: 'p1', name: 'Focaccia', price: 4.5, quantity: 1, sellerId: 's1' }] as never }));
  });
  return { div, root };
}
const PX: Record<string, number> = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20 };
const misura = (el: Element) => PX[[...el.classList].find((x) => PX[x]) ?? ''] ?? 0;

describe('R02-005 — nel «Completa con» il prezzo comanda sul «+»', () => {
  it('il «+» è un contorno: niente fondo pieno colorato, area di tocco 44 punti', async () => {
    const { div, root } = await striscia();
    const bottone = div.querySelector('button[aria-label$="al carrello"]') as HTMLButtonElement;
    expect(bottone, 'la scheda del suggerimento non c è più').toBeTruthy();
    expect(bottone.className, 'quadrato pieno colorato').not.toMatch(/(^|\s)bg-primary-(500|600|700)(\s|$)/);
    expect(bottone.className).toMatch(/(^|\s)border-2(\s|$)/);
    expect(bottone.className).toMatch(/(^|\s)border-primary-(600|700|800)(\s|$)/);
    expect(bottone.className).toMatch(/\bh-11\b/);
    expect(bottone.className).toMatch(/\bw-11\b/);
    root.unmount();
  });

  it('il prezzo è più grande del nome', async () => {
    const { div, root } = await striscia();
    const nome = [...div.querySelectorAll('p')].find((p) => p.textContent?.includes('Grissini stirati'))!;
    const prezzo = [...div.querySelectorAll('span')].find((s) => /€/.test(s.textContent ?? ''))!;
    expect(prezzo, 'il prezzo non c è più').toBeTruthy();
    expect(misura(prezzo)).toBeGreaterThan(misura(nome) + 3);
    root.unmount();
  });
});
