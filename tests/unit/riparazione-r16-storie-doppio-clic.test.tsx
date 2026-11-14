/**
 * @vitest-environment jsdom
 */
/**
 * R16-012 — Un doppio clic su «Pubblica (24h)» pubblicava la stessa storia due volte.
 *
 * Il bottone guardava solo `uploading`, che la pagina accendeva dentro la mutazione, dopo aver letto
 * l'utente: fra il primo e il secondo tocco il bottone era ancora attivo. Qui si monta la pagina delle
 * storie del negozio con un Supabase finto che conta i salvataggi, si sceglie una foto e si preme
 * «Pubblica (24h)» due volte di fila: deve nascere una storia sola, con una foto sola.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen, within, fireEvent } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({
  insert: vi.fn(),
  carica: vi.fn(),
  toastOk: vi.fn(),
  toastErr: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => {
  const lettura = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) q[m] = () => q;
    q.limit = async () => ({ data: [], error: null });
    return q;
  };
  return {
    supabase: {
      // L'utente arriva dopo un giro, come dal vero: è lì che il freno vecchio arrivava tardi.
      auth: { getUser: () => new Promise((ok) => setTimeout(() => ok({ data: { user: { id: 'negozio-1' } } }), 5)) },
      from: () => ({ ...lettura(), insert: stato.insert }),
    },
  };
});
vi.mock('@/lib/storage/carica-immagine', () => ({ caricaImmagine: stato.carica }));
vi.mock('sonner', () => ({ toast: { success: stato.toastOk, error: stato.toastErr } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { alt: String(p.alt ?? '') }) };
});

import SellerStoriesPage from '@/app/seller/stories/page';

const accesi: Root[] = [];
const aspetta = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  stato.insert.mockResolvedValue({ error: null });
  stato.carica.mockImplementation(() => new Promise((ok) => setTimeout(() => ok({ publicUrl: 'https://x/storia.jpg' }), 10)));
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

async function apriConUnaFoto() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerStoriesPage))); });
  await aspetta(30);
  await act(async () => { screen.getByRole('button', { name: /Nuova storia/ }).click(); });
  const dialogo = screen.getByRole('dialog');
  const foto = dialogo.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], 'fragole.jpg', { type: 'image/jpeg' });
  await act(async () => { fireEvent.change(foto, { target: { files: [file] } }); });
  return within(dialogo).getByRole('button', { name: /Pubblica/ }) as HTMLButtonElement;
}

describe('R16-012 · un doppio clic su «Pubblica (24h)» pubblica una storia sola', () => {
  it('due tocchi di fila: una foto caricata e una storia salvata', async () => {
    const pubblica = await apriConUnaFoto();
    await act(async () => {
      pubblica.click();
      pubblica.click();
    });
    await aspetta(50);
    expect(stato.carica).toHaveBeenCalledTimes(1);
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.toastOk).toHaveBeenCalledTimes(1);
  });

  it('mentre carica il bottone è spento, e il secondo tocco non fa niente', async () => {
    const pubblica = await apriConUnaFoto();
    await act(async () => { pubblica.click(); });
    expect(pubblica.disabled).toBe(true);
    await act(async () => { pubblica.click(); });
    await aspetta(50);
    expect(stato.insert).toHaveBeenCalledTimes(1);
  });

  it('se la pubblicazione non riesce, si può riprovare', async () => {
    stato.insert.mockResolvedValueOnce({ error: { message: 'guasto' } });
    const pubblica = await apriConUnaFoto();
    await act(async () => { pubblica.click(); });
    await aspetta(50);
    expect(stato.toastErr).toHaveBeenCalledTimes(1);
    await act(async () => { pubblica.click(); });
    await aspetta(50);
    expect(stato.insert).toHaveBeenCalledTimes(2);
    expect(stato.toastOk).toHaveBeenCalledTimes(1);
  });
});
