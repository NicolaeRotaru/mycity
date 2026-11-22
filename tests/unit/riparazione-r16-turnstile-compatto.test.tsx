/**
 * @vitest-environment jsdom
 */
/**
 * R16-007 — il widget Turnstile normale è largo 300 px e su un telefono stretto (testo grande, 280 px)
 * allarga la pagina. Sotto i 340 px di schermo si chiede il widget compatto; sopra, il normale.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Turnstile from '@/components/Turnstile';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function monta(larghezza: number) {
  Object.defineProperty(window, 'innerWidth', { value: larghezza, configurable: true, writable: true });
  const render = vi.fn(() => 'w1');
  (window as any).__turnstileLoaded = true;
  (window as any).turnstile = { render, remove: vi.fn(), reset: vi.fn() };
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(createElement(Turnstile, { siteKey: 'k', onVerify: () => undefined })); });
  const opts = (render.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
  await act(async () => { root.unmount(); });
  return opts;
}

afterEach(() => { delete (window as any).turnstile; delete (window as any).__turnstileLoaded; document.body.innerHTML = ''; });

describe('R16-007 · Turnstile e telefoni stretti', () => {
  it('sotto 340 px chiede il widget compatto', async () => {
    expect((await monta(280)).size).toBe('compact');
  });
  it('da 340 px in su chiede il normale', async () => {
    expect((await monta(390)).size).toBe('normal');
  });
  it('la pagina contatti tiene il widget dentro lo schermo', () => {
    const src = readFileSync(join(process.cwd(), 'app/contact/page.tsx'), 'utf8');
    expect(src).toContain('<div className="flex justify-center max-w-full overflow-hidden">');
  });
});
