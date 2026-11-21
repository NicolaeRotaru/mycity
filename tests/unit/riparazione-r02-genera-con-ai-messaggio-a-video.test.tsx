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
