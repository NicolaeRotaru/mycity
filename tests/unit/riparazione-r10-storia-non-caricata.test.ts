/**
 * @vitest-environment jsdom
 */
/**
 * R10-015 — Se il caricamento della foto di una storia falliva perché il magazzino delle foto non
 * rispondeva, il negoziante leggeva «Bucket "stories" non configurato. Applica la migration 035.»:
 * un'istruzione per chi gestisce il database. Adesso legge cosa è successo e cosa può fare, e il
 * dettaglio tecnico finisce nei registri.
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
  registro: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => {
  const lettura = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gt', 'order']) q[m] = () => q;
    q.limit = async () => ({ data: [], error: null });
    return q;
  };
  return {
    supabase: {
      rpc: () => Promise.resolve({}),
      auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) },
      from: () => ({ ...lettura(), insert: stato.insert }),
    },
  };
});
vi.mock('@/lib/storage/carica-immagine', () => ({ caricaImmagine: stato.carica }));
vi.mock('@/lib/logger', () => ({ logger: { error: stato.registro, warn: vi.fn(), info: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: stato.toastOk, error: stato.toastErr } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { alt: String(p.alt ?? '') }) };
});

import SellerStoriesPage from '@/app/seller/stories/page';

const accesi: Root[] = [];

async function accendi(elemento: ReturnType<typeof createElement>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(elemento); });
  return radice;
}

beforeEach(() => {
  stato.insert.mockResolvedValue({ error: null });
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

async function pubblica() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await accendi(createElement(QueryClientProvider, { client: qc }, createElement(SellerStoriesPage)));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { screen.getByRole('button', { name: /Nuova storia/ }).click(); });
  const dialogo = screen.getByRole('dialog');
  const foto = dialogo.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], 'fragole.jpg', { type: 'image/jpeg' });
  await act(async () => { fireEvent.change(foto, { target: { files: [file] } }); });
  await act(async () => { within(dialogo).getByRole('button', { name: /Pubblica/ }).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

/** Quello che il negoziante legge nell'avviso rosso. */
function avviso(): string {
  expect(stato.toastErr, 'nessun avviso di errore è arrivato al negoziante').toHaveBeenCalledTimes(1);
  return String(stato.toastErr.mock.calls[0][0]);
}

describe('R10-015 · la foto della storia non si carica perché il magazzino non risponde', () => {
  it.each([
    ['il magazzino non esiste', 'Bucket not found'],
    ['l\'oggetto non si trova', 'Object not found'],
    ['un altro errore che nomina il magazzino', 'The related bucket is not available'],
  ])('%s: il negoziante non legge gergo tecnico', async (_caso, messaggioDelloStorage) => {
    stato.carica.mockRejectedValue(new Error(messaggioDelloStorage));
    await pubblica();
    const testo = avviso();
    expect(testo, 'il negoziante legge istruzioni per chi gestisce il database').not.toMatch(/migration|migrazione|035|bucket/i);
    expect(testo, 'il negoziante legge l\'inglese dello storage').not.toMatch(/not found|not available/i);
    expect(testo).toMatch(/Non sono riuscito a caricare la foto della storia/);
    expect(testo, 'l\'avviso non dice cosa fare').toMatch(/Riprova/);
    expect(stato.insert, 'una storia senza foto non si salva').not.toHaveBeenCalled();
  });

  it('il dettaglio tecnico resta nei registri', async () => {
    stato.carica.mockRejectedValue(new Error('Bucket not found'));
    await pubblica();
    expect(stato.registro).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(stato.registro.mock.calls[0])).toContain('Bucket not found');
  });

  it('controprova: un errore che il negoziante può correggere arriva com\'è', async () => {
    stato.carica.mockRejectedValue(new Error('La foto è troppo pesante: il limite è 10 MB. Riducila o scattane un\'altra.'));
    await pubblica();
    expect(avviso()).toMatch(/troppo pesante/);
  });
});
