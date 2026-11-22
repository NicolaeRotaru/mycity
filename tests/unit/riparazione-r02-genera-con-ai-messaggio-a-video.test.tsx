/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Il bottone «Genera con AI» montato davvero: sopra un campo vuoto avvisa che il testo si puo
 * modificare, sopra una descrizione gia scritta (dove ProductForm mostra solo una proposta da
 * accettare) non dice «modifica come preferisci».
 *
 * Giro di correzione (22/11): il campo resta modificabile mentre si aspetta, e ProductForm sceglie
 * fra proposta e testo nel campo col valore di quando arriva la risposta. Il messaggio guarda lo
 * stesso momento: qui il testo cambia durante l'attesa.
 */
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));

import AIDescriptionButton from '@/components/AIDescriptionButton';

let div: HTMLDivElement;
let root: Root;

async function premi(currentText: string) {
  div = document.createElement('div');
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => {
    root.render(createElement(AIDescriptionButton, { productName: 'Pane', currentText, onResult: () => {} }));
  });
  await act(async () => {
    div.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('il messaggio di «Genera con AI», a video', () => {
  beforeEach(() => {
    toast.success.mockClear();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ description: 'Un pane rustico.' }), { status: 200 }));
  });
  afterEach(() => {
    root.unmount();
    div.remove();
    vi.unstubAllGlobals();
  });

  it('sopra un campo vuoto: «modifica come preferisci»', async () => {
    await premi('');
    expect(toast.success).toHaveBeenCalledWith('Descrizione generata — modifica come preferisci');
  });

  it('sopra una descrizione gia scritta e una proposta: il messaggio non dice «modifica come preferisci»', async () => {
    await premi('Pane di Altamura con lievito madre');
    expect(toast.success).toHaveBeenCalledTimes(1);
    const msg = String(toast.success.mock.calls[0][0]);
    expect(msg).toMatch(/proposta/i);
    expect(msg).not.toMatch(/modifica come preferisci/);
  });
});

describe('il messaggio guarda il testo di quando arriva la risposta, non di quando si è premuto', () => {
  let rispondi: () => void = () => undefined;
  const ricevuti: string[] = [];
  const disegna = (currentText: string) =>
    root.render(createElement(AIDescriptionButton, { productName: 'Pane', currentText, onResult: (t: string) => { ricevuti.push(t); } }));

  beforeEach(() => {
    toast.success.mockClear();
    ricevuti.length = 0;
    vi.stubGlobal('fetch', () => new Promise<Response>((r) => {
      rispondi = () => r(new Response(JSON.stringify({ description: 'Un pane rustico.' }), { status: 200 }));
    }));
    div = document.createElement('div');
    document.body.appendChild(div);
    root = createRoot(div);
  });
  afterEach(() => {
    root.unmount();
    div.remove();
    vi.unstubAllGlobals();
  });

  async function premiECambia(prima: string, durante: string) {
    await act(async () => { disegna(prima); });
    await act(async () => {
      div.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    // Il negoziante scrive (o cancella) nel campo mentre il modello lavora.
    await act(async () => { disegna(durante); });
    await act(async () => {
      rispondi();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ricevuti).toEqual(['Un pane rustico.']);
  }

  it('campo vuoto al clic, scritto durante l\'attesa: è una proposta, non «modifica come preferisci»', async () => {
    await premiECambia('', 'Pane di Altamura con lievito madre');
    expect(toast.success).toHaveBeenCalledTimes(1);
    const msg = String(toast.success.mock.calls[0][0]);
    expect(msg).toMatch(/proposta/i);
    expect(msg).not.toMatch(/modifica come preferisci/);
  });

  it('testo al clic, cancellato durante l\'attesa: il testo entra nel campo, «modifica come preferisci»', async () => {
    await premiECambia('Pane di Altamura con lievito madre', '');
    expect(toast.success).toHaveBeenCalledWith('Descrizione generata — modifica come preferisci');
  });
});
