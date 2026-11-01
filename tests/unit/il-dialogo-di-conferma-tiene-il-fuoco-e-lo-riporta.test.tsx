// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * IL DIALOGO DI CONFERMA TIENE IL FUOCO E LO RIPORTA.
 *
 * 31/10/2026 — La dichiarazione di accessibilita' (app/accessibility/page.tsx) promette che
 * le conferme trattengono il fuoco e lo riportano al punto di partenza. Il dialogo dichiara
 * role="dialog" aria-modal="true": promette allo screen reader che la pagina dietro e'
 * inerte. Se col Tab se ne esce, o se alla chiusura il fuoco cade sul corpo della pagina,
 * la promessa e' falsa (WCAG 2.4.3 e 4.1.2). E' il dialogo che chiede «Annullare
 * l'ordine?» al cliente.
 *
 * Qui si monta il dialogo vero, si preme Tab dall'ultimo bottone e Maiusc+Tab dal primo,
 * poi Esc: il fuoco deve girare dentro e tornare al bottone che l'ha aperto.
 */

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import { ConfirmDialogHost, confirmDialog } from '@/components/ConfirmDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let contenitore: HTMLDivElement;
let apri: HTMLButtonElement;

beforeEach(async () => {
  apri = document.createElement('button');
  apri.textContent = 'Annulla ordine';
  document.body.appendChild(apri);
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () => root.render(createElement(ConfirmDialogHost)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

function premi(tasto: string, maiuscolo = false) {
  const dove = document.activeElement ?? document.body;
  dove.dispatchEvent(new KeyboardEvent('keydown', { key: tasto, shiftKey: maiuscolo, bubbles: true, cancelable: true }));
}

describe('il dialogo di conferma', () => {
  it('col Tab il fuoco gira fra i bottoni del dialogo, e con Esc torna a chi l\'ha aperto', async () => {
    apri.focus();
    let esito: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      esito = confirmDialog({ title: "Annullare l'ordine?", confirmLabel: 'Sì, annulla', cancelLabel: 'No' });
    });

    const dialogo = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogo).not.toBeNull();
    const bottoni = Array.from(dialogo.querySelectorAll('button'));
    expect(bottoni.length).toBeGreaterThanOrEqual(2);
    expect(dialogo.contains(document.activeElement), 'il fuoco entra nel dialogo').toBe(true);

    const primo = bottoni[0];
    const ultimo = bottoni[bottoni.length - 1];
    ultimo.focus();
    await act(async () => premi('Tab'));
    expect(document.activeElement, 'Tab dall\'ultimo bottone torna al primo, non esce').toBe(primo);
    await act(async () => premi('Tab', true));
    expect(document.activeElement, 'Maiusc+Tab dal primo va all\'ultimo').toBe(ultimo);

    await act(async () => premi('Escape'));
    await expect(esito).resolves.toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement, 'alla chiusura il fuoco torna al bottone che ha aperto').toBe(apri);
  });
});
