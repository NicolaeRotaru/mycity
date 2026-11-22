/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queries/keys';

/**
 * La bozza del nuovo prodotto tenuta nel browser è di chi l'ha scritta: si salva col suo id, si
 * riapre solo a lui, si toglie all'uscita voluta e quando entra un altro. Pagina e QueryProvider
 * veri, database finto.
 */

const CHIAVE = 'mc_new_product_draft';

const stato = vi.hoisted(() => {
  const s = {
    utente: 'negozio-1' as string | null,
    ascolti: [] as Array<(evento: string, sessione: { user: { id: string } } | null) => void>,
    client: null as unknown,
  };
  const catena = (tavola: string) => {
    let conLimite = false;
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.eq = () => c;
    c.limit = () => { conLimite = true; return c; };
    const riga = () => {
      if (tavola === 'profiles') return { data: { offers_express: true }, error: null };
      if (conLimite) return { data: { id: 'qualsiasi', non_recedibile: false }, error: null };
      return { data: null, error: { code: 'PGRST116', message: 'nessuna riga' } };
    };
    c.single = async () => riga();
    c.maybeSingle = async () => riga();
    c.insert = () => ({ select: () => ({ single: async () => ({ data: { id: 'nuovo-1' }, error: null }) }) });
    c.then = (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const r = tavola === 'categories'
        ? { data: [{ id: 'c-casa', name: 'Casa', slug: 'casa', parent_id: null }], error: null }
        : { data: [], error: null };
      return Promise.resolve(r).then(ok, ko);
    };
    return c;
  };
  const auth = {
    getUser: async () => ({ data: { user: s.utente ? { id: s.utente } : null }, error: null }),
    getSession: async () => ({
      data: { session: s.utente ? { access_token: 'tok', user: { id: s.utente } } : null },
    }),
    onAuthStateChange: (ascolto: (evento: string, sessione: { user: { id: string } } | null) => void) => {
      s.ascolti.push(ascolto);
      return { data: { subscription: { unsubscribe: () => { s.ascolti = s.ascolti.filter((a) => a !== ascolto); } } } };
    },
    signOut: async () => {
      s.utente = null;
      for (const a of [...s.ascolti]) a('SIGNED_OUT', null);
      return { error: null };
    },
  };
  s.client = { auth, from: (tavola: string) => catena(tavola) };
  return s;
});

vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: stato.client }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/seller/products/new',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/components/ui/LoadingState', async () => {
  const { createElement: ce } = await import('react');
  return { LoadingState: () => ce('p', null, 'CARICAMENTO') };
});
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: async () => true }));
vi.mock('@/lib/analytics/events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackProductPublished: vi.fn(),
  trackErrorShown: vi.fn(),
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async () => [],
  saveProductVariants: async () => undefined,
  controllaScorteVariantiDalBrowser: async () => undefined,
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: PaginaNuovo } = await import('@/app/seller/products/new/page');
const { default: QueryProvider } = await import('@/components/providers/QueryProvider');

const CATEGORIE = [{ id: 'c-casa', name: 'Casa', slug: 'casa', parent_id: null }];
const BOZZA = {
  name: 'Vaso in ceramica', description: 'Vaso in ceramica smaltata a mano, alto venti centimetri.',
  price: 18, stock: 2, category_id: 'c-casa', imageUrls: [], attributes: {}, tags: [], unit: 'pezzo',
};

const accesi: Root[] = [];
async function aspetta(ms = 30) {
  for (let fatto = 0; fatto < ms; fatto += 5) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

async function monta(elemento: ReturnType<typeof createElement>) {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(queryKeys.categories.form, CATEGORIE);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, elemento));
  });
  await aspetta(80);
  return radice;
}

const campoNome = (radice: HTMLElement) => radice.querySelector<HTMLInputElement>('input[name="name"]');
const bozzaSalvata = () => {
  const grezza = localStorage.getItem(CHIAVE);
  return grezza === null ? null : (JSON.parse(grezza) as Record<string, unknown>);
};

async function scrivi(el: HTMLInputElement | null, valore: string) {
  expect(el, 'controprova: il campo del nome deve essere a video').toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valore);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  stato.utente = 'negozio-1';
  stato.ascolti = [];
  try { localStorage.clear(); } catch { /* niente */ }
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('«Nuovo prodotto»: la bozza nel browser è di chi l\'ha scritta', () => {
  it('una bozza senza autore non si apre nel modulo e si toglie', async () => {
    localStorage.setItem(CHIAVE, JSON.stringify({ ...BOZZA, name: 'Bozza di chi c\'era prima' }));
    const radice = await monta(createElement(PaginaNuovo));
    expect(campoNome(radice), 'controprova: il modulo deve essere a video').toBeTruthy();
    expect(campoNome(radice)?.value).toBe('');
    expect(localStorage.getItem(CHIAVE)).toBeNull();
  });

  it('la bozza di un altro negoziante non si apre nel modulo e si toglie', async () => {
    localStorage.setItem(CHIAVE, JSON.stringify({ autore: 'negozio-2', bozza: { ...BOZZA, name: 'Bozza del vicino' } }));
    const radice = await monta(createElement(PaginaNuovo));
    expect(campoNome(radice)?.value).not.toBe('Bozza del vicino');
    expect(localStorage.getItem(CHIAVE)).toBeNull();
  });

  it('la bozza propria si riapre', async () => {
    localStorage.setItem(CHIAVE, JSON.stringify({ autore: 'negozio-1', bozza: BOZZA }));
    const radice = await monta(createElement(PaginaNuovo));
    expect(campoNome(radice)?.value).toBe('Vaso in ceramica');
  });

  it('quello che si scrive si salva col nome di chi lo scrive', async () => {
    const radice = await monta(createElement(PaginaNuovo));
    await scrivi(campoNome(radice), 'Lampada di ottone');
    await aspetta(800);
    const salvata = bozzaSalvata();
    expect(salvata?.autore).toBe('negozio-1');
    expect((salvata?.bozza as { name?: string } | undefined)?.name).toBe('Lampada di ottone');
  });
});

describe('All\'uscita e all\'entrata la bozza segue la sessione', () => {
  async function conIlFornitore() {
    await monta(createElement(QueryProvider, null, createElement('p', null, 'pagina')));
    expect(stato.ascolti.length, 'controprova: QueryProvider deve ascoltare la sessione').toBeGreaterThan(0);
  }
  const annuncia = async (evento: string, chi: string | null) => {
    await act(async () => { for (const a of [...stato.ascolti]) a(evento, chi ? { user: { id: chi } } : null); });
  };

  it('all\'uscita voluta la bozza se ne va', async () => {
    await conIlFornitore();
    localStorage.setItem(CHIAVE, JSON.stringify({ autore: 'negozio-1', bozza: BOZZA }));
    const { supabase } = await import('@/lib/supabase/client');
    await act(async () => { await supabase.auth.signOut(); });
    expect(localStorage.getItem(CHIAVE)).toBeNull();
  });

  it('quando entra un altro la bozza se ne va, quando rientra chi l\'ha scritta resta', async () => {
    await conIlFornitore();
    localStorage.setItem(CHIAVE, JSON.stringify({ autore: 'negozio-1', bozza: BOZZA }));
    await annuncia('SIGNED_IN', 'negozio-1');
    expect(bozzaSalvata()?.autore).toBe('negozio-1');
    await annuncia('SIGNED_IN', 'negozio-2');
    expect(localStorage.getItem(CHIAVE)).toBeNull();
  });

  it('alla sessione scaduta (uscita non chiesta) la bozza aspetta il rientro', async () => {
    await conIlFornitore();
    localStorage.setItem(CHIAVE, JSON.stringify({ autore: 'negozio-1', bozza: BOZZA }));
    await annuncia('SIGNED_OUT', null);
    expect(bozzaSalvata()?.autore).toBe('negozio-1');
  });
});
