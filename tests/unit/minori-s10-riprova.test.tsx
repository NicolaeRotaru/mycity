// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * S10 (5/11/2026, scheda 1813) — «Riprova» dà un segno: gira mentre rilegge,
 * e se fallisce ancora lo dice.
 */

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => (k === 'retry' ? 'Riprova' : k) }));

import { ErrorState } from '@/components/ui/ErrorState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('«Riprova» si vede (1813)', () => {
  it('mentre rilegge il pulsante è occupato, dopo un nuovo fallimento compare il messaggio', async () => {
    let finisci: () => void = () => {};
    const rilettura = new Promise<void>((r) => { finisci = r; });
    const c = document.createElement('div');
    document.body.appendChild(c);
    root = createRoot(c);
    await act(async () => root.render(createElement(ErrorState, { retry: () => rilettura })));
    const bottone = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Riprova'))!;
    await act(async () => bottone.click());
    expect(bottone.getAttribute('aria-busy') === 'true' || bottone.disabled).toBe(true);
    await act(async () => { finisci(); await rilettura; });
    expect(document.body.textContent).toMatch(/non ci sono ancora riuscito/);
  });
});
