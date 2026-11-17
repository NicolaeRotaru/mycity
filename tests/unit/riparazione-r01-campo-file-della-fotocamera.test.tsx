/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R01-002 — Quando la fotocamera del negoziante non parte, la finestra offre il pulsante «Usa la
 * fotocamera del telefono», che apre un campo file nascosto (sr-only). Quel campo si raggiungeva
 * anche col Tab: il fuoco ci finiva sopra e a video non si vedeva niente. Il campo resta (lo apre
 * il pulsante), ma fuori dall'ordine del Tab.
 * Banco del montaggio preso da minori-s06-fotocamera.test.tsx.
 */
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: unknown }) => (open ? createElement('div', null, children as never) : null),
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('R01-002 — il campo file nascosto della fotocamera', () => {
  it('con la fotocamera negata il Tab va sul pulsante visibile, non sul campo nascosto', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => { throw new DOMException('negato', 'NotAllowedError'); } },
    });
    const { default: CameraCapture } = await import('@/components/seller/CameraCapture');
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(createElement(CameraCapture, { open: true, onClose: () => {}, onCapture: () => {} })); });
    await act(async () => { await Promise.resolve(); });

    expect(div.textContent, 'controprova: la finestra deve dire che il permesso è negato').toContain('Permesso fotocamera negato');
    const pulsante = [...div.querySelectorAll('button')].find((b) => /Usa la fotocamera del telefono/.test(b.textContent ?? ''));
    expect(pulsante, 'controprova: il pulsante visibile che apre il campo deve esserci').toBeTruthy();
    const campo = div.querySelector<HTMLInputElement>('input[type="file"]');
    expect(campo, 'controprova: il campo file deve esserci, lo apre il pulsante').toBeTruthy();

    // Quello che il Tab raggiunge: gli elementi con tabIndex >= 0 (il campo file lo è di natura).
    const raggiungibili = [...div.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]')].filter((e) => e.tabIndex >= 0);
    expect(raggiungibili, 'il campo nascosto prende il fuoco col Tab senza mostrarlo').not.toContain(campo);
    expect(raggiungibili).toContain(pulsante);

    // Il pulsante continua ad aprire il campo.
    const apri = vi.spyOn(campo!, 'click');
    await act(async () => { pulsante!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apri).toHaveBeenCalledTimes(1);
    root.unmount();
  });
});
