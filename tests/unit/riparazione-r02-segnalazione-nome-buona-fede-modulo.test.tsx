// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R02-016 — Il modulo «Segnala» ha il campo del nome e la casella della buona fede (facoltativi),
 * e li manda alla rotta. Con uno dei due il testo ha 300 caratteri in meno, detto prima di inviare.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('R02-016 — il modulo chiede nome e buona fede', () => {
  let root: Root | null = null;
  let box: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    box = document.createElement('div');
    document.body.appendChild(box);
  });
  afterEach(async () => { await act(async () => { root?.unmount(); }); box.remove(); vi.unstubAllGlobals(); });

  async function apri() {
    const { Segnala } = await import('@/components/Segnala');
    root = createRoot(box);
    await act(async () => { root!.render(createElement(Segnala, { tipo: 'prodotto', oggettoId: '00000000-0000-4000-8000-000000000001' })); });
    const pulsante = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'))!;
    await act(async () => { pulsante.click(); });
  }

  async function scrivi(el: HTMLInputElement | HTMLTextAreaElement, valore: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    await act(async () => { setter.call(el, valore); el.dispatchEvent(new Event('input', { bubbles: true })); });
  }

  const invia = async () => {
    const b = [...document.body.querySelectorAll('button')].find((x) => x.textContent?.includes('Invia segnalazione'))!;
    await act(async () => { b.click(); });
  };

  it('IL CASO CHE ROMPEVA — nome e buona fede si scrivono nel modulo e arrivano alla rotta', async () => {
    const fetchFinto = vi.fn(async (_u: string, _o: RequestInit) => new Response(JSON.stringify({ ok: true, id: 'x' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFinto);
    await apri();
    const nome = document.getElementById('segnala-nome') as HTMLInputElement | null;
    const casella = document.getElementById('segnala-buona-fede') as HTMLInputElement | null;
    expect(nome, 'il modulo non ha il campo del nome').not.toBeNull();
    expect(casella, 'il modulo non ha la dichiarazione di buona fede').not.toBeNull();
    expect(casella!.type).toBe('checkbox');
    await scrivi(nome!, '  Marchio Srl ');
    await act(async () => { casella!.click(); });
    await invia();
    expect(fetchFinto).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse(String(fetchFinto.mock.calls[0][1].body));
    expect(corpo).toMatchObject({ nomeSegnalante: 'Marchio Srl', buonaFede: true });
  });

  it('con il nome, un testo oltre 1700 caratteri si dice sotto il campo e non parte', async () => {
    const fetchFinto = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchFinto);
    await apri();
    await scrivi(document.getElementById('segnala-dettaglio') as HTMLTextAreaElement, 'a'.repeat(1800));
    await scrivi(document.getElementById('segnala-nome') as HTMLInputElement, 'Mario');
    await invia();
    expect(fetchFinto).not.toHaveBeenCalled();
    expect(document.getElementById('segnala-dettaglio-errore')?.textContent).toMatch(/1700/);
  });
});
