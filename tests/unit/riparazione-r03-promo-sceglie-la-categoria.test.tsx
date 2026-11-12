/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';

/**
 * R03-020 (parte del modulo) — «Una categoria specifica» fa scegliere quale categoria, e senza
 * categoria la promo non parte. Prima l'inserimento mandava scope='category' senza category_id:
 * nessun prodotto scontato, ma la vetrina annunciava «-15%». La parte del database (vincolo e
 * promo già nate annullate) sta in tests/sql/rls/riparazione-r03-promo-senza-bersaglio.test.sql.
 */

type Esito = { data: unknown; error: { message: string } | null };
type Op = { tabella: string; azione: string; valori?: unknown; filtri: Array<[string, unknown]> };
const stato: {
  esiti: Record<string, (op: Op) => Esito>;
  ops: Op[];
  toast: Array<{ tipo: string; testo: string }>;
  spinte: string[];
} = { esiti: {}, ops: [], toast: [], spinte: [] };

function costruttore(tabella: string) {
  const op: Op = { tabella, azione: 'select', filtri: [] };
  const esito = () => (stato.esiti[tabella] ?? (() => ({ data: [], error: null })))(op);
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'or', 'in']) q[m] = () => q;
  q.eq = (c: string, v: unknown) => { op.filtri.push([`eq:${c}`, v]); return q; };
  q.neq = (c: string, v: unknown) => { op.filtri.push([`neq:${c}`, v]); return q; };
  q.insert = (v: unknown) => { op.azione = 'insert'; op.valori = v; return q; };
  q.update = (v: unknown) => { op.azione = 'update'; op.valori = v; return q; };
  q.delete = () => { op.azione = 'delete'; return q; };
  q.single = async () => { stato.ops.push({ ...op }); return esito(); };
  q.maybeSingle = q.single;
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    stato.ops.push({ ...op });
    return Promise.resolve(esito()).then(ok, ko);
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'anna@example.com' } }, error: null }) },
    from: (t: string) => costruttore(t),
  },
}));
vi.mock('next/navigation', () => {
  const rotta = { push: (u: string) => { stato.spinte.push(u); }, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
  return { useRouter: () => rotta };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return ce('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => {
  const r = (tipo: string) => (testo: string) => { stato.toast.push({ tipo, testo }); };
  return { toast: { success: r('success'), error: r('error'), info: r('info'), warning: r('warning') } };
});
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {}, trackReferralSent: () => {} }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  INVITI_E_PUNTI_ACCESI: true,
  CLASSIFICA_INVITI_ACCESA: true,
}));

async function aspetta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function conQuery(Pagina: ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Avvolta() {
    return createElement(QueryClientProvider, { client }, createElement(Pagina));
  };
}

beforeEach(() => {
  stato.esiti = {};
  stato.ops = [];
  stato.toast = [];
  stato.esiti.seller_promotions = (op) => (op.azione === 'select' ? { data: [], error: null } : { data: null, error: null });
  stato.esiti.products = () => ({ data: [{ category_id: 'cat-dolci' }, { category_id: 'cat-pane' }], error: null });
  stato.esiti.categories = () => ({ data: [{ id: 'cat-dolci', name: 'Dolci' }, { id: 'cat-pane', name: 'Pane' }], error: null });
});

const pulsante = (testo: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(testo)) as HTMLButtonElement | undefined;

describe('R03-020 — la promo su una categoria fa scegliere la categoria', () => {
  it('scelta «Una categoria specifica»: compare la scelta, e la promo parte col category_id', async () => {
    const { default: Pagina } = await import('@/app/seller/promotions/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    s.agisci(() => pulsante('Nuova promo')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    await aspetta();
    const radio = Array.from(document.querySelectorAll('input[name="scope"]'))[1] as HTMLInputElement;
    s.agisci(() => radio.click());
    await aspetta();
    const scelta = Array.from(document.querySelectorAll('select')).find((el) => Array.from(el.options).some((o) => o.value === 'cat-dolci')) as HTMLSelectElement | undefined;
    expect(scelta, 'la categoria non si può scegliere').toBeTruthy();
    expect(pulsante('Crea promo')!.disabled, 'senza categoria la promo parte lo stesso').toBe(true);
    s.agisci(() => {
      scelta!.value = 'cat-dolci';
      scelta!.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await aspetta();
    s.agisci(() => pulsante('Crea promo')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    await aspetta();
    const inserita = stato.ops.find((o) => o.tabella === 'seller_promotions' && o.azione === 'insert')?.valori as Record<string, unknown> | undefined;
    expect(inserita).toBeTruthy();
    expect(inserita!.scope).toBe('category');
    expect(inserita!.category_id).toBe('cat-dolci');
    s.smonta();
  });
});
