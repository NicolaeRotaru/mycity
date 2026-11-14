/**
 * @vitest-environment jsdom
 *
 * R18-002 — I campi «scegli file» devono restare raggiungibili col Tab (non `hidden`, cioè
 * display:none), avere un nome accessibile e un anello di fuoco sul riquadro.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';

vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'g' } } }),
    },
    from: () => ({ select: () => Promise.resolve({ data: [] }) }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  CARICAMENTO_DA_FILE_ACCESO: true,
}));

import Pagina from '@/app/seller/products/import/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('R18-002 campi file da tastiera', () => {
  it('importazione CSV: il campo non è hidden, ha un nome, il riquadro mostra il fuoco', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => { root.render(createElement(Pagina)); });
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    const input = box.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.classList.contains('hidden')).toBe(false);
    expect(input.classList.contains('sr-only')).toBe(true);
    expect(input.getAttribute('aria-label')).toBe('Scegli il file CSV');
    expect(input.closest('label')!.className).toContain('focus-within:ring-2');
    act(() => root.unmount());
    box.remove();
  });

  it('reso: il campo ha un nome chiaro e il riquadro mostra il fuoco', () => {
    const src = readFileSync('app/orders/[id]/return/page.tsx', 'utf8');
    const label = src.match(/<label className="[^"]*h-20 w-20[^"]*">/)![0];
    expect(label).toContain('focus-within:ring-2');
    expect(src).toContain('aria-label="Aggiungi una foto alla richiesta di reso"');
    expect(src).not.toMatch(/type="file"[^>]*className="hidden"/);
  });
});
