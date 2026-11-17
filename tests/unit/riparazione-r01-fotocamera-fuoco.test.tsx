/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CameraCapture from '@/components/seller/CameraCapture';

/**
 * R01-006 (17/11/2026) — quando la fotocamera del browser non parte, la finestra offre
 * «Usa la fotocamera del telefono». Prima era un pulsante che apriva un campo file
 * sr-only messo accanto: col Tab si passava dal pulsante al campo invisibile, e lì il
 * fuoco non si vedeva. Ora il campo sta dentro l'etichetta: una fermata sola, e
 * l'anello si vede sull'etichetta. Si monta con il Modal vero, così si vede anche che
 * la trappola del fuoco resta chiusa (il motivo per cui tabIndex=-1 era stato tolto).
 */
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const FOCUSABILI = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let root: Root | null = null;
let div: HTMLDivElement | null = null;

async function apriSenzaFotocamera() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.reject(new DOMException('no', 'NotAllowedError')) },
  });
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => {
    root!.render(createElement(CameraCapture, { open: true, onClose: () => {}, onCapture: () => {} }));
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const dialogo = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialogo).not.toBeNull();
  expect(dialogo!.textContent).toContain('Permesso fotocamera negato.');
  return dialogo!;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  div?.remove();
  root = null;
  div = null;
});

describe('R01-006 · il campo della fotocamera del telefono mostra il fuoco', () => {
  it('«Usa la fotocamera del telefono» è una fermata sola di Tab, ed è il campo file', async () => {
    const dialogo = await apriSenzaFotocamera();
    const fermate = Array.from(dialogo.querySelectorAll<HTMLElement>(FOCUSABILI)).filter((el) => el.tabIndex >= 0);
    const perLaFotocamera = fermate.filter((el) => el.getAttribute('aria-label') !== 'Chiudi');
    expect(perLaFotocamera).toHaveLength(1);
    const campo = perLaFotocamera[0] as HTMLInputElement;
    expect(campo.tagName).toBe('INPUT');
    expect(campo.type).toBe('file');
    // Il nome del campo è la scritta che si vede: l'etichetta lo contiene.
    const etichetta = campo.closest('label');
    expect(etichetta).not.toBeNull();
    expect(etichetta!.textContent).toContain('Usa la fotocamera del telefono');
  });

  it("quando il campo invisibile ha il fuoco, l'anello si vede sull'etichetta", async () => {
    const dialogo = await apriSenzaFotocamera();
    const campo = dialogo.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(campo.className).toContain('sr-only');
    const etichetta = campo.closest('label');
    expect(etichetta).not.toBeNull();
    expect(etichetta!.className).toMatch(/\bfocus-within:ring-2\b/);
  });

  it('la trappola del fuoco del Modal resta chiusa: dal campo il Tab torna a «Chiudi» e viceversa', async () => {
    const dialogo = await apriSenzaFotocamera();
    const campo = dialogo.querySelector<HTMLInputElement>('input[type="file"]')!;
    const chiudi = dialogo.querySelector<HTMLButtonElement>('button[aria-label="Chiudi"]')!;
    campo.focus();
    expect(document.activeElement).toBe(campo);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    expect(document.activeElement).toBe(chiudi);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(campo);
  });
});
