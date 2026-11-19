/**
 * @vitest-environment jsdom
 */
/**
 * R09-006 — Il negoziante copia dalla barra «https://<dominio>/promozioni» e il link delle storie
 * lo rifiutava. Se il dominio è quello del sito stesso si salva il percorso; un altro dominio,
 * anche somigliante, no.
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
vi.mock('sonner', () => ({ toast: { success: stato.toastOk, error: stato.toastErr } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { alt: String(p.alt ?? '') }) };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: ({ href, children, className }: Record<string, unknown>) =>
      ce('a', { href: String(href), className: className as string }, children as never),
  };
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
  stato.carica.mockResolvedValue({ publicUrl: 'https://x/storia.jpg' });
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

async function pubblicaConLink(link: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await accendi(createElement(QueryClientProvider, { client: qc }, createElement(SellerStoriesPage)));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { screen.getByRole('button', { name: /Nuova storia/ }).click(); });
  const dialogo = screen.getByRole('dialog');
  const foto = dialogo.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], 'fragole.jpg', { type: 'image/jpeg' });
  await act(async () => { fireEvent.change(foto, { target: { files: [file] } }); });
  const campoLink = dialogo.querySelector('input:not([type="file"])') as HTMLInputElement;
  await act(async () => { fireEvent.change(campoLink, { target: { value: link } }); });
  await act(async () => { within(dialogo).getByRole('button', { name: /Pubblica/ }).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const ORIGINE = window.location.origin;

describe('R09-006 · il link con l\'indirizzo intero del sito stesso', () => {
  it('https://<dominio>/promozioni si salva come /promozioni', async () => {
    await pubblicaConLink(`${ORIGINE}/promozioni`);
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ link_url: '/promozioni' });
  });

  it('tiene anche la ricerca e il #', async () => {
    await pubblicaConLink(`  ${ORIGINE}/categoria/frutta?ordine=nuovi#in-evidenza `);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ link_url: '/categoria/frutta?ordine=nuovi#in-evidenza' });
  });

  it.each([
    ['un altro dominio', 'https://sito-truffa.example/promozioni'],
    ['un dominio che comincia come il nostro', `${ORIGINE}.sito-truffa.example/promozioni`],
    ['un indirizzo con il nostro nome prima della @', `${ORIGINE}@sito-truffa.example/promozioni`],
    ['il nostro dominio con un indirizzo esterno nel percorso', `${ORIGINE}//sito-truffa.example`],
  ])('%s non si salva', async (_chi, link) => {
    await pubblicaConLink(link);
    expect(stato.insert).not.toHaveBeenCalled();
    expect(stato.carica).not.toHaveBeenCalled();
  });

  it('il percorso scritto a mano resta quello di prima', async () => {
    await pubblicaConLink('/promozioni');
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ link_url: '/promozioni' });
  });
});
