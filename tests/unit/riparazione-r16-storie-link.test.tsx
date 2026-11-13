/**
 * @vitest-environment jsdom
 */
/**
 * R16-011 — Il link «Scopri di più» delle storie accettava qualunque indirizzo, anche un sito esterno.
 *
 * La pagina delle storie del negozio salvava il link così com'era, e il visore lo apriva con un
 * <Link>: una storia della vetrina poteva portare il cliente fuori da MyCity senza nessun avviso.
 * Qui si monta il visore con un link esterno e uno interno, e si monta la pagina del negozio con un
 * Supabase finto che conta i salvataggi: un link esterno non si salva, uno interno sì.
 * (La regola nel database la prova tests/sql/rls/riparazione-r16-link-storie.test.sql.)
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

import StoryViewer from '@/components/StoryViewer';
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

const storia = (link_url: string | null) => ({
  id: 'st-1', image_url: 'https://x/storia.jpg', caption: 'Fragole del Trebbia', link_url,
  seller: { id: 'negozio-1', store_name: 'Frutta di Ada', store_logo: null },
});

function scopriDiPiu(): HTMLAnchorElement | null {
  return (Array.from(document.querySelectorAll('a')).find((a) => /Scopri di più/.test(a.textContent ?? '')) ??
    null) as HTMLAnchorElement | null;
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

describe('R16-011 · il visore apre solo i link che portano dentro MyCity', () => {
  it('una storia col link a un sito esterno non mostra «Scopri di più»', async () => {
    await accendi(createElement(StoryViewer, { stories: [storia('https://sito-truffa.example/offerta')], onClose: () => {} }));
    expect(scopriDiPiu()?.getAttribute('href') ?? null).toBeNull();
  });

  it('nemmeno un sito esterno travestito da percorso (//… o /\\…)', async () => {
    await accendi(createElement(StoryViewer, { stories: [storia('//sito-truffa.example')], onClose: () => {} }));
    expect(scopriDiPiu()?.getAttribute('href') ?? null).toBeNull();
    for (const r of accesi.splice(0)) act(() => r.unmount());
    await accendi(createElement(StoryViewer, { stories: [storia('/\\sito-truffa.example')], onClose: () => {} }));
    expect(scopriDiPiu()?.getAttribute('href') ?? null).toBeNull();
  });

  it('una storia col link a una pagina del sito porta lì', async () => {
    await accendi(createElement(StoryViewer, { stories: [storia('/promozioni')], onClose: () => {} }));
    expect(scopriDiPiu()?.getAttribute('href')).toBe('/promozioni');
  });
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

describe('R16-011 · la pagina del negozio salva solo un link a una pagina di MyCity', () => {
  it('un link a un sito esterno non si salva, non carica la foto, e dice perché', async () => {
    await pubblicaConLink('https://sito-truffa.example/offerta');
    expect(stato.insert).not.toHaveBeenCalled();
    expect(stato.carica).not.toHaveBeenCalled();
    const detto = stato.toastErr.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(detto.includes('pagina di MyCity'), `l'avviso al negoziante: «${detto}»`).toBe(true);
  });

  it('un link che comincia con // non si salva', async () => {
    await pubblicaConLink('//sito-truffa.example');
    expect(stato.insert).not.toHaveBeenCalled();
  });

  it('un link a una pagina del sito si salva così com’è', async () => {
    await pubblicaConLink('  /promozioni ');
    expect(stato.insert).toHaveBeenCalledTimes(1);
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ seller_id: 'negozio-1', link_url: '/promozioni' });
  });
});
