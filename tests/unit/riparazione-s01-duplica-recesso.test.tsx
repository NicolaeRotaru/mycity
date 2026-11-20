/**
 * @vitest-environment jsdom
 */
/**
 * S01-002 — «Duplica» di un prodotto escluso dal recesso: la copia non nasce recedibile in silenzio.
 *
 * La pagina mostra la spunta «Escluso dal recesso», e la manda a chi salva, solo se sa che la banca
 * dati ha la colonna (migrazione 180). Lo chiedeva a una lettura a parte: finché quella non
 * rispondeva (in volo, caduta, senza rete) valeva «no». Così la copia di un pane escluso dal
 * recesso nasceva recedibile, senza spunta a video e senza avviso. Ma in «Duplica» la risposta c'è
 * già: il prodotto da duplicare è letto con `*`, e se ha `non_recedibile` la colonna c'è.
 *
 * Qui la pagina vera, il modulo vero e React Query vero; finti solo Supabase e le taglie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const SORGENTE = 'p-pane';

type Esito = { data: unknown; error: unknown };

const stato = vi.hoisted(() => {
  const s = {
    sorgente: null as Record<string, unknown> | null,
    /** La lettura «c'è la colonna del recesso?»: un esito, oppure `null` = non risponde mai. */
    colonna: null as Esito | null,
    inserimenti: [] as Array<Record<string, unknown>>,
    client: null as unknown,
  };
  const catena = (tavola: string) => {
    let conLimite = false;
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.eq = () => c;
    c.limit = () => { conLimite = true; return c; };
    const riga = (): Promise<Esito> => {
      if (tavola === 'profiles') return Promise.resolve({ data: { offers_express: true }, error: null });
      if (conLimite) return s.colonna ? Promise.resolve(s.colonna) : new Promise<Esito>(() => undefined);
      return Promise.resolve({ data: s.sorgente, error: null });
    };
    c.single = () => riga();
    c.maybeSingle = () => riga();
    c.insert = (payload: Record<string, unknown>) => {
      s.inserimenti.push(payload);
      return { select: () => ({ single: async () => ({ data: { id: 'copia-1' }, error: null }) }) };
    };
    c.then = (ok: (r: Esito) => unknown, ko?: (e: unknown) => unknown) => {
      const r: Esito = tavola === 'categories'
        ? { data: [{ id: 'c-alim', name: 'Casa', slug: 'casa', parent_id: null }], error: null }
        : { data: [], error: null };
      return Promise.resolve(r).then(ok, ko);
    };
    return c;
  };
  s.client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'negozio-1' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
    },
    from: (tavola: string) => catena(tavola),
  };
  return s;
});

vi.mock('@/lib/supabase/client', () => ({ supabase: stato.client }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/seller/products/new',
  useSearchParams: () => new URLSearchParams(`from=${SORGENTE}`),
}));
vi.mock('@/components/ui/LoadingState', async () => {
  const { createElement: ce } = await import('react');
  return { LoadingState: () => ce('p', null, 'CARICAMENTO') };
});
vi.mock('@/lib/analytics/events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackProductPublished: vi.fn(),
  trackErrorShown: vi.fn(),
}));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async () => [],
  saveProductVariants: async () => undefined,
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: PaginaNuovo } = await import('@/app/seller/products/new/page');

const PANE = {
  id: SORGENTE, seller_id: 'negozio-1', name: 'Pane di Altamura', description: 'Pane di semola rimacinata, cotto nel forno a legna ogni mattina.',
  price: 4, compare_at_price: null, unit: 'pezzo', condition: null, stock: 6, category_id: 'c-alim',
  images: ['https://x/pane.jpg'], attributes: {}, tags: [], express_enabled: true, status: 'available',
};

const accesi: Root[] = [];
async function aspetta(ms = 60) {
  for (let fatto = 0; fatto < ms; fatto += 5) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

async function apriCopia() {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(PaginaNuovo))); });
  await aspetta(80);
  expect(radice.querySelector<HTMLInputElement>('input[name="name"]')?.value, 'controprova: la copia è aperta').toBe('Pane di Altamura (copia)');
  return radice;
}

const spuntaRecesso = (radice: HTMLElement) =>
  [...radice.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes('Escluso dal recesso'))?.querySelector('input') ?? null;

async function pubblica(radice: HTMLElement) {
  const b = [...radice.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Pubblica prodotto'));
  expect(b, 'controprova: il pulsante «Pubblica prodotto» deve essere a video').toBeTruthy();
  await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  await aspetta(80);
}

beforeEach(() => {
  stato.sorgente = { ...PANE, non_recedibile: true };
  stato.colonna = { data: { id: 'qualsiasi', non_recedibile: false }, error: null };
  stato.inserimenti = [];
  try { localStorage.clear(); } catch { /* niente */ }
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('S01-002 · «Duplica» di un prodotto escluso dal recesso', () => {
  it('la lettura della colonna cade: la copia nasce esclusa dal recesso, con la spunta a video', async () => {
    stato.colonna = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    const radice = await apriCopia();
    expect(spuntaRecesso(radice)?.checked, 'la spunta «Escluso dal recesso» non c\'è: la copia sembra recedibile').toBe(true);
    await pubblica(radice);
    expect(stato.inserimenti).toHaveLength(1);
    expect(stato.inserimenti[0].non_recedibile, 'la copia del pane è nata recedibile senza avviso').toBe(true);
  });

  it('la lettura della colonna non risponde ancora: la copia nasce esclusa dal recesso', async () => {
    stato.colonna = null;
    const radice = await apriCopia();
    await pubblica(radice);
    expect(stato.inserimenti).toHaveLength(1);
    expect(stato.inserimenti[0].non_recedibile, 'finché non si sa se la colonna c\'è, la copia si è salvata recedibile').toBe(true);
  });

  it('controprova: la colonna c\'è e lo dice la sua lettura: la copia nasce esclusa, come prima', async () => {
    const radice = await apriCopia();
    await pubblica(radice);
    expect(stato.inserimenti[0].non_recedibile).toBe(true);
  });

  it('controprova: prima della migrazione 180 (la riga non ha la colonna) la copia si salva senza mandarla', async () => {
    stato.sorgente = { ...PANE };
    stato.colonna = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    const radice = await apriCopia();
    expect(spuntaRecesso(radice), 'senza la colonna la spunta non si salverebbe: non deve comparire').toBeNull();
    await pubblica(radice);
    expect(stato.inserimenti).toHaveLength(1);
    expect(stato.inserimenti[0]).not.toHaveProperty('non_recedibile');
  });
});
