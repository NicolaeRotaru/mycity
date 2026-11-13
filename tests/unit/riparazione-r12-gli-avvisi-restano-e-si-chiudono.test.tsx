/**
 * @vitest-environment jsdom
 */
/**
 * R12-003 — I messaggi di errore del sito sparivano da soli dopo 4 secondi (il
 * default di sonner) e non avevano la X per chiuderli.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const visti = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('sonner', () => ({
  Toaster: (p: Record<string, unknown>) => { visti.props = p; return null; },
  toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import ToastProvider from '@/components/providers/ToastProvider';

describe('R12-003 gli avvisi restano il tempo di leggerli e si chiudono con la X', () => {
  it('ha la X e dura più dei 4 secondi di sonner', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const c = document.createElement('div');
    const r = createRoot(c);
    await act(async () => { r.render(createElement(ToastProvider)); });
    expect(visti.props?.closeButton).toBe(true);
    const durata = (visti.props?.toastOptions as { duration?: number } | undefined)?.duration ?? 4000;
    expect(durata).toBeGreaterThanOrEqual(6000);
    act(() => r.unmount());
  });
});
