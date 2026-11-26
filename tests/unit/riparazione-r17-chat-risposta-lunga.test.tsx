// @vitest-environment jsdom
/**
 * R17-013 — Nella chat assistenza la bolla della risposta teneva a capo ed elenchi appiattiti
 * (una descrizione lunga diventava un muro di testo) e una risposta lunga non aveva «Leggi tutto».
 * Qui il componente è montato davvero: l'assistente risponde con un elenco, poi con un testo lungo.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';

const globali = globalThis as Record<string, unknown>;
globali.IS_REACT_ACT_ENVIRONMENT = true;

let radice: Root | null = null;
let div: HTMLDivElement | null = null;
let Chat: unknown;
let risposta = '';

beforeEach(async () => {
  // jsdom non fa scorrere: la chat porta in fondo il filo a ogni messaggio.
  Element.prototype.scrollTo = () => {};
  globali.__UTENTE__ = { id: 'forno' };
  globali.__GETTONE__ = 'gettone-finto';
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ reply: risposta }), { status: 200, headers: { 'content-type': 'application/json' } }));
  Chat = (await monta('components/SupportProductAssistant.tsx')).default;
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => { (radice as Root).render(createElement(Chat as never)); });
});
afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  vi.unstubAllGlobals();
});

async function scrivi(testo: string) {
  const area = div!.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(area, testo);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { (div!.querySelector('button[aria-label="Invia"]') as HTMLButtonElement).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const bolleAssistente = () => Array.from(div!.querySelectorAll('div.bg-cream-100')) as HTMLElement[];
const leggiTutto = () => Array.from(div!.querySelectorAll('button')).find((b) => /leggi tutto/i.test(b.textContent ?? ''));

describe('R17-013 la bolla della risposta', () => {
  it('a capo ed elenchi restano: la bolla non li appiattisce e il testo ha le righe', async () => {
    risposta = 'Ho trovato il prodotto:\n- Pane di segale\n- Pane integrale\n\nVuoi cambiare il prezzo?';
    await scrivi('pane');
    const bolla = bolleAssistente().find((b) => b.textContent?.includes('Pane di segale'))!;
    expect(bolla).toBeTruthy();
    expect(bolla.className).toMatch(/whitespace-pre-line/);
    expect(bolla.textContent).toBe(risposta);
    expect(bolla.innerHTML).not.toMatch(/<(ul|li|script)/);
    expect(leggiTutto()).toBeUndefined();
  });

  it('una risposta lunga si ripiega e «Leggi tutto» la apre', async () => {
    risposta = 'Descrizione molto lunga. '.repeat(40);
    await scrivi('descrivimi');
    const bottone = leggiTutto();
    expect(bottone).toBeTruthy();
    const testo = div!.querySelector('[data-testid="risposta-lunga"]')!;
    expect(testo.className).toMatch(/line-clamp/);
    expect(bottone!.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { bottone!.click(); });
    expect(div!.querySelector('[data-testid="risposta-lunga"]')!.className).not.toMatch(/line-clamp/);
    expect(div!.textContent).toMatch(/Mostra meno/);
    expect(div!.textContent).toContain(risposta.trim());
  });
});
