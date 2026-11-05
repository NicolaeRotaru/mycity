/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';

/**
 * Sessione S02 (5/11/2026) — il pannello «Contatta» della pagina dell'ordine.
 *  · 661:  una nuova funzione di chiusura (la pagina si rilegge a ogni posizione del fattorino)
 *          non riporta il fuoco su «Chiudi»;
 *  · 1619: niente più «Invia un messaggio» che chiude il pannello senza mandare niente.
 */
let ContactSheet: ComponentType<Record<string, unknown>>;
beforeAll(async () => {
  ContactSheet = (await monta('components/orders/ContactSheet.tsx')).ContactSheet as ComponentType<Record<string, unknown>>;
}, 120000);

const TARGET = { kind: 'rider', name: 'Nicola', sub: 'Il tuo rider', phone: '333 1234567', orderRef: '#A1B2C3' };

describe('il pannello di contatto', () => {
  it('661 · rimontato con una chiusura nuova, il fuoco resta dove l ha messo la persona', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => root.render(createElement(ContactSheet, { target: TARGET, onClose: () => {} })));
    const chiama = radice.querySelector('a[href^="tel:"]') as HTMLAnchorElement;
    chiama.focus();
    expect(document.activeElement).toBe(chiama);
    await act(async () => root.render(createElement(ContactSheet, { target: TARGET, onClose: () => {} })));
    expect(document.activeElement, 'il fuoco è tornato su «Chiudi»').toBe(chiama);
    await act(async () => root.unmount());
    radice.remove();
  });

  it('1619 · nessun pulsante «Invia un messaggio» che non manda niente', async () => {
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => root.render(createElement(ContactSheet, { target: { ...TARGET, kind: 'store' }, onClose: () => {} })));
    expect(radice.textContent).not.toContain('Invia un messaggio');
    await act(async () => root.unmount());
    radice.remove();
  });
});
