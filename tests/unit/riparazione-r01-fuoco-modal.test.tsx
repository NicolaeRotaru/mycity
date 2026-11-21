// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import { Modal } from '@/components/ui/Modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let contenitore: HTMLDivElement;

beforeEach(async () => {
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () =>
    root.render(
      createElement(
        Modal as never,
        { open: true, onClose: () => {}, title: 'Prova' },
        createElement('input', { id: 'primo' }),
        createElement('input', { id: 'ultimo' }),
        createElement('button', { id: 'fuori-tab', tabIndex: -1 }, 'x'),
        createElement('input', { id: 'campo-fuori-tab', tabIndex: -1 }),
      ),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('R01-001 la trappola del fuoco ignora i campi con tabindex -1', () => {
  it('Tab dall ultimo campo raggiungibile riporta il fuoco al primo', async () => {
    const ultimo = document.getElementById('ultimo') as HTMLElement;
    const primo = document.querySelector('[role="dialog"] button') as HTMLElement; // il primo attivabile e' il pulsante di chiusura
    ultimo.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(primo);
  });
  it('Shift+Tab dal primo porta il fuoco all ultimo raggiungibile', async () => {
    const ultimo = document.getElementById('ultimo') as HTMLElement;
    const primo = document.querySelector('[role="dialog"] button') as HTMLElement; // il primo attivabile e' il pulsante di chiusura
    primo.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(document.activeElement).toBe(ultimo);
  });
});
