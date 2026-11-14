// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R20-008 — Il Drop del giorno (pagina admin) leggeva senza guardare l'errore e usava il giorno
 * di Greenwich. Il giorno di Roma e la lettura dei drop li ha sistemati R07-017 (12/11); restava la
 * lettura dei PRODOTTI: caduta, il menu «Prodotto» restava vuoto senza una parola, come se non
 * ci fosse niente da mettere in offerta.
 *
 * Orologio finto: il 13 novembre alle 00:30 a Roma, a Greenwich ancora il 12.
 */
const stato = vi.hoisted(() => ({ gte: [] as unknown[], prodottiInErrore: false, dropsInErrore: false }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      const passa = () => b;
      const risposta = () => {
        if (t === 'products') {
          return stato.prodottiInErrore
            ? { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }
            : { data: [{ id: 'p1', name: 'Torta di mele', price: 18 }], error: null };
        }
        if (t === 'daily_drops' && stato.dropsInErrore) return { data: null, error: { message: 'rete giù' } };
        return { data: [], error: null };
      };
      Object.assign(b, {
        select: passa, eq: passa, order: passa, limit: passa,
        gte: (_c: string, v: unknown) => { stato.gte.push(v); return b; },
        then: (ok: (r: unknown) => unknown) => Promise.resolve(risposta()).then(ok),
      });
      return b;
    },
  },
}));

const { default: AdminDailyDropsPage } = await import('@/app/admin/daily-drops/page');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(AdminDailyDropsPage))));
  for (let i = 0; i < 6; i++) await pausa();
}
const opzioniProdotto = () => Array.from(c.querySelectorAll('select option')).map((o) => o.textContent ?? '').filter((t) => !t.includes('Seleziona'));

beforeEach(() => {
  stato.gte = [];
  stato.prodottiInErrore = false;
  stato.dropsInErrore = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T23:30:00Z'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.useRealTimers();
});

describe('R20-008 — il Drop del giorno guarda l’errore e conta il giorno di Roma', () => {
  it('con la lettura dei prodotti caduta lo dice e offre di riprovare, invece di un menu vuoto', async () => {
    stato.prodottiInErrore = true;
    await monta();
    expect(opzioniProdotto()).toEqual([]);
    expect(c.textContent, 'la lettura dei prodotti è caduta e la pagina mostra solo un menu vuoto').toContain('Non riesco a leggere i prodotti');
    // Riprova: la lettura torna, e i prodotti arrivano nel menu.
    stato.prodottiInErrore = false;
    const riprova = Array.from(c.querySelectorAll('[role="alert"] button')).find((b) => (b.textContent ?? '').includes('Riprova')) as HTMLButtonElement | undefined;
    expect(riprova, 'manca il «Riprova» della lettura dei prodotti').toBeTruthy();
    expect(riprova!.disabled, 'il «Riprova» non si può premere').toBe(false);
    await act(async () => { riprova!.click(); });
    for (let i = 0; i < 6; i++) await pausa();
    expect(c.textContent).not.toContain('Non riesco a leggere i prodotti');
    expect(opzioniProdotto().join(' ')).toContain('Torta di mele');
  });

  it('controllo: con la lettura riuscita i prodotti ci sono e nessun avviso', async () => {
    await monta();
    expect(opzioniProdotto().join(' ')).toContain('Torta di mele');
    expect(c.textContent).not.toContain('Non riesco a leggere i prodotti');
  });

  it('controllo: alle 00:30 di Roma il giorno è il 13 (data minima, proposta, elenco), non il 12 di Greenwich', async () => {
    await monta();
    const data = c.querySelector('input[type=date]') as HTMLInputElement;
    expect(data.min).toBe('2026-11-13');
    expect(data.value).toBe('2026-11-13');
    expect(stato.gte).toEqual(expect.arrayContaining(['2026-11-13']));
    expect(stato.gte).not.toContain('2026-11-12');
  });

  it('controllo: la notte del cambio dell’ora (25/10, 00:30 a Roma = 22:30 UTC del 24) il giorno è il 25', async () => {
    vi.setSystemTime(new Date('2026-10-24T22:30:00Z'));
    await monta();
    const data = c.querySelector('input[type=date]') as HTMLInputElement;
    expect(data.min).toBe('2026-10-25');
    expect(stato.gte).not.toContain('2026-10-24');
  });

  it('controllo: con la lettura dei drop caduta non dice «Nessun drop»', async () => {
    stato.dropsInErrore = true;
    await monta();
    expect(c.textContent).not.toContain('Nessun drop');
    expect(c.textContent).toContain('Non riesco a leggere i drop programmati');
  });
});
