// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * S10 (5/11/2026, scheda 2152) — Esc sulla finestra di conferma chiude la
 * conferma, non anche la finestra che sta sotto.
 */

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import { Modal } from '@/components/ui/Modal';
import { ConfirmDialogHost, confirmDialog } from '@/components/ConfirmDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let contenitore: HTMLDivElement;
const chiudiSotto = vi.fn();

beforeEach(async () => {
  chiudiSotto.mockClear();
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () =>
    root.render(
      createElement('div', null, [
        createElement(Modal as never, { key: 'm', open: true, onClose: chiudiSotto, title: 'Modifica utente' }, createElement('input')),
        createElement(ConfirmDialogHost, { key: 'c' }),
      ]),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('Esc sulla conferma (2152)', () => {
  it('chiude la conferma e lascia aperta la finestra sotto', async () => {
    let esito: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      esito = confirmDialog({ title: 'Cambiare il ruolo?', confirmLabel: 'Sì', cancelLabel: 'No' });
    });
    await act(async () => {
      const dove = document.activeElement ?? document.body;
      dove.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await expect(esito).resolves.toBe(false);
    expect(chiudiSotto).not.toHaveBeenCalled();
  });
  it('senza conferma aperta, Esc chiude la finestra come prima', async () => {
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(chiudiSotto).toHaveBeenCalledTimes(1);
  });
});
