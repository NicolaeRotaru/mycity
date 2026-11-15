/**
 * @vitest-environment jsdom
 */
/**
 * R16-013 — Una storia a meno di mezz'ora dalla scadenza risultava «scaduta» al negozio, mentre i
 * clienti la vedevano ancora.
 *
 * La pagina del negozio decideva con le ore rimaste arrotondate (sotto i 30 minuti: 0, quindi
 * «scaduta»); il carosello dei clienti chiede le storie con `expires_at` dopo adesso. Qui l'orologio
 * è fermo alle 10:00 del 10/11/2026 e la storia scade alle 10:20: si monta la pagina del negozio e il
 * carosello in home, con lo stesso Supabase finto, e tutti e due devono dirla attiva.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Storia = { id: string; seller_id: string; image_url: string; caption: string | null; link_url: null; view_count: number; expires_at: string; created_at: string };

const mondo = vi.hoisted(() => ({ storie: [] as Storia[] }));

vi.mock('@/lib/supabase/client', () => {
  // Le storie si filtrano come farebbe il database: `gt` e `eq` valgono davvero.
  const storie = () => {
    const filtri: Array<(s: Storia) => boolean> = [];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => q;
    q.eq = (c: keyof Storia, v: unknown) => { filtri.push((s) => s[c] === v); return q; };
    q.gt = (c: keyof Storia, v: string) => { filtri.push((s) => String(s[c]) > v); return q; };
    q.limit = async () => ({ data: mondo.storie.filter((s) => filtri.every((f) => f(s))), error: null });
    return q;
  };
  const vetrina = () => ({
    select: () => ({
      in: async (_c: string, ids: string[]) => ({
        data: ids.filter((id) => id === 'negozio-1').map((id) => ({ id, is_approved: true, store_name: 'Frutta di Ada', store_logo: null })),
        error: null,
      }),
    }),
  });
  return {
    supabase: {
      rpc: () => Promise.resolve({}),
      auth: { getUser: async () => ({ data: { user: { id: 'negozio-1' } } }) },
      from: (t: string) => (t === 'seller_public_profiles' ? vetrina() : storie()),
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { alt: String(p.alt ?? ''), className: p.className as string }) };
});

import SellerStoriesPage from '@/app/seller/stories/page';
import StoriesCarousel from '@/components/home/StoriesCarousel';

const ADESSO = new Date('2026-11-10T10:00:00Z');
const tra = (minuti: number) => new Date(ADESSO.getTime() + minuti * 60_000).toISOString();
const storia = (id: string, scade: string): Storia => ({
  id, seller_id: 'negozio-1', image_url: `https://x/${id}.jpg`, caption: `Storia ${id}`, link_url: null,
  view_count: 0, expires_at: scade, created_at: tra(-60),
});

const accesi: Root[] = [];

async function accendi(componente: () => ReturnType<typeof createElement> | null) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(componente))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return radice;
}

/** Sulla pagina del negozio: la scritta sulla foto della storia («1h», «scaduta»). */
function etichettaNelNegozio(radice: HTMLElement, id: string): string {
  const foto = radice.querySelector(`img[alt="Storia ${id}"]`);
  return (foto?.parentElement?.textContent ?? '(storia non trovata)').replace(/\d+$/, '').trim();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('R16-013 · una storia che scade fra 20 minuti è attiva per il negozio e per i clienti', () => {
  it('il negozio la vede attiva, non «scaduta»', async () => {
    mondo.storie = [storia('venti-minuti', tra(20))];
    const radice = await accendi(SellerStoriesPage);
    const etichetta = etichettaNelNegozio(radice, 'venti-minuti');
    expect(etichetta).not.toMatch(/scaduta/);
    expect(etichetta).toBe('1h');
    expect(radice.querySelector('img[alt="Storia venti-minuti"]')?.className).not.toMatch(/grayscale/);
  });

  it('i clienti la vedono nel carosello in home', async () => {
    mondo.storie = [storia('venti-minuti', tra(20))];
    const radice = await accendi(StoriesCarousel);
    expect(radice.textContent).toContain('Frutta di Ada');
  });

  it('una storia scaduta da 10 minuti è «scaduta» per il negozio e sparisce per i clienti', async () => {
    mondo.storie = [storia('passata', tra(-10))];
    const negozio = await accendi(SellerStoriesPage);
    expect(etichettaNelNegozio(negozio, 'passata')).toBe('scaduta');
    for (const r of accesi.splice(0)) act(() => r.unmount());
    const home = await accendi(StoriesCarousel);
    expect(home.textContent ?? '').not.toContain('Frutta di Ada');
  });

  it('una storia che scade fra 5 ore dice «5h»', async () => {
    mondo.storie = [storia('cinque-ore', tra(5 * 60))];
    const radice = await accendi(SellerStoriesPage);
    expect(etichettaNelNegozio(radice, 'cinque-ore')).toBe('5h');
  });
});
