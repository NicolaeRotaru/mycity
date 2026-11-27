/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * IL PULSANTE «AGGIUNGI ATTIVITÀ» — 27/11/2026. L'agente preme, il sito chiede se il titolare ha detto sì,
 * e solo dopo il «Sì, aggiungi» chiama il server; poi mostra il link del preventivo da copiare.
 * «Non ancora» non chiama niente.
 */
const { default: AggiungiAttivita } = await import('@/components/agenti/AggiungiAttivita');

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
  await act(async () => { root!.render(createElement(AggiungiAttivita, { lavoro: '11111111-2222-4333-8444-555555555555', nome: 'Ora del Gusto' })); });
  return radice;
}
const bottone = (r: HTMLElement, testo: string) => [...r.querySelectorAll('button')].find((b) => b.textContent === testo) as HTMLButtonElement;

describe('il pulsante sotto la scheda', () => {
  it('chiede conferma, poi aggiunge e mostra il link del preventivo', async () => {
    const chiamate: { url: string; corpo: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, o: { body: string }) => {
      chiamate.push({ url, corpo: o.body });
      return new Response(JSON.stringify({ ok: true, data: { nome: 'Ora del Gusto', nuova: true, link: 'https://www.mycity-marketplace.com/preventivo/abc', avvisato: false } }), { status: 201 });
    }));
    const r = await monta();
    await act(async () => { bottone(r, 'Aggiungi attività').click(); });
    expect(r.textContent).toContain('Il titolare di Ora del Gusto ha detto sì?');
    expect(chiamate).toHaveLength(0);
    await act(async () => { bottone(r, 'Sì, aggiungi').click(); });
    expect(chiamate).toEqual([{ url: '/api/agente/aggiungi', corpo: JSON.stringify({ lavoro: '11111111-2222-4333-8444-555555555555' }) }]);
    expect(r.textContent).toContain('Ora del Gusto è su MyCity');
    expect(r.textContent).toContain('https://www.mycity-marketplace.com/preventivo/abc');
    expect(r.textContent).toContain('contanti');
    expect(r.textContent).toContain('L’avviso a Nicola non è partito');
    expect(r.textContent).not.toContain('Nicola ha ricevuto l’avviso');
    expect(bottone(r, 'Copia il link')).toBeTruthy();
  });

  it('«Non ancora» torna indietro senza chiamare il server; un errore si legge', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { message: 'Questa attività ha già accettato il preventivo: è già su MyCity.' } }), { status: 409 }));
    vi.stubGlobal('fetch', f);
    const r = await monta();
    await act(async () => { bottone(r, 'Aggiungi attività').click(); });
    await act(async () => { bottone(r, 'Non ancora').click(); });
    expect(f).not.toHaveBeenCalled();
    expect(bottone(r, 'Aggiungi attività')).toBeTruthy();
    await act(async () => { bottone(r, 'Aggiungi attività').click(); });
    await act(async () => { bottone(r, 'Sì, aggiungi').click(); });
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('già accettato');
  });
});
