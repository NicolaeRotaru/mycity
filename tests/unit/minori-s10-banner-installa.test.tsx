// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * S10 (5/11/2026, scheda 379) — il contatore delle visite del banner
 * «Metti MyCity in schermata Home» parte dal valore salvato, non da zero.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import PWAInstallBanner from '@/components/PWAInstallBanner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;

let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  window.localStorage.clear();
});

describe('il contatore delle visite cresce (379)', () => {
  it('con 2 visite salvate, la terza apertura salva 3', async () => {
    window.localStorage.setItem('mc_pwa_visits', '2');
    const c = document.createElement('div');
    document.body.appendChild(c);
    root = createRoot(c);
    await act(async () => root.render(createElement(PWAInstallBanner)));
    expect(window.localStorage.getItem('mc_pwa_visits')).toBe('3');
  });
});
