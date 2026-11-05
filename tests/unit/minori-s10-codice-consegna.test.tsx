// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * S10 (5/11/2026) — la finestra dove il fattorino scrive il codice.
 * 429: dopo cinque codici sbagliati dice che è bloccata per 15 minuti.
 * 657: Esc chiude anche col fuoco fuori dal riquadro, e il fuoco torna al pulsante.
 */

import VerifyCodeDialog from '@/components/VerifyCodeDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

function Banco({ esito }: { esito: { ok: boolean; reason?: string } }) {
  const [aperta, setAperta] = useState(false);
  return createElement('div', null, [
    createElement('button', { key: 'b', id: 'apri', onClick: () => setAperta(true) }, 'Conferma consegna'),
    createElement(VerifyCodeDialog, {
      key: 'd',
      open: aperta,
      title: 'Codice di consegna',
      description: 'Chiedilo al cliente',
      ctaLabel: 'Conferma',
      onClose: () => setAperta(false),
      onSubmit: async () => esito,
    }),
  ]);
}

async function monta(esito: { ok: boolean; reason?: string }) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(Banco, { esito })));
  const apri = document.getElementById('apri') as HTMLButtonElement;
  apri.focus();
  await act(async () => apri.click());
  await act(async () => new Promise((r) => setTimeout(r, 150)));
  return apri;
}

describe('il codice bloccato si dice (429)', () => {
  it('LOCKED → «bloccata per 15 minuti»', async () => {
    await monta({ ok: false, reason: 'LOCKED' });
    const campo = document.getElementById('verify-code') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(campo, '123456');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (campo.form as HTMLFormElement).requestSubmit();
    });
    expect(document.body.textContent).toMatch(/bloccata per 15 minuti/);
  });
});

describe('la finestra trattiene e riporta il fuoco (657)', () => {
  it('Esc dal corpo della pagina chiude, e il fuoco torna a «Conferma consegna»', async () => {
    const apri = await monta({ ok: true });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(apri);
  });
});
