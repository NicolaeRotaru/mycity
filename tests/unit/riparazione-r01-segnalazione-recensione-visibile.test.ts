/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R01-006 (27/11/2026) — NEL PANNELLO DELLE SEGNALAZIONI LO STAFF VEDE LA RECENSIONE SU CUI DECIDE.
 *
 * Prima una recensione segnalata era solo un codice: niente testo, niente link, e non si sapeva se
 * era di un prodotto o di un negozio. Ora la scheda mostra di cosa è, il voto, il testo e il link,
 * letti dalla rotta delle segnalazioni (solo amministratori). La rotta è quella vera: le chiamate
 * della pagina arrivano al gestore del metodo, come fa Next (405 se la rotta non ce l'ha).
 */

const banco = vi.hoisted(() => ({
  riga: null as Record<string, unknown> | null,
  tabelle: {} as Record<string, Record<string, unknown> | null>,
}));

// La pagina, con il client del browser finto.
vi.mock('@/lib/supabase/client', () => {
  const catena = () => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'in', 'eq']) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: banco.riga ? [banco.riga] : [], error: null }).then(ok, ko);
    return c;
  };
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) }, from: () => ({ select: catena }) } };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));

// La rotta vera, con una banca dati finta.
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => h({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/app/api/segnalazioni/esito/comunica', () => ({ MOTIVAZIONE_MINIMA: 20, comunicaEsito: async () => ({ ok: true }) }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: banco.tabelle[t] ?? null, error: null });
      return q;
    },
  }),
}));

import Pagina from '@/app/admin/segnalazioni/page';
import * as rotta from '@/app/api/segnalazioni/route';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID_RECENSIONE = '00000000-0000-4000-8000-0000000000a1';

function rigaRecensione() {
  return {
    id: '00000000-0000-4000-8000-000000000077', tipo: 'recensione', oggetto_id: ID_RECENSIONE,
    motivo: 'ingannevole', dettaglio: 'recensione falsa', email_contatto: null, segnalante_id: null,
    stato: 'ricevuta', esito_motivato: null, deciso_at: null, created_at: '2026-11-20T10:00:00Z',
  };
}

async function disegna() {
  const gestori = rotta as unknown as Record<string, unknown>;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const metodo = (init?.method ?? 'get').toUpperCase();
    const gestore = gestori[metodo];
    if (typeof gestore !== 'function') return new Response(null, { status: 405 });
    return (gestore as (r: Request) => Promise<Response>)(new Request(new URL(String(url), 'http://x'), init));
  }) as unknown as typeof fetch;
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
  return { box, root };
}

async function aspettaTesto(box: HTMLElement, testo: string) {
  await vi.waitFor(() => { expect(box.textContent).toContain(testo); }, { timeout: 4000 });
}

describe('R01-006 · lo staff decide su una recensione vedendola', () => {
  beforeEach(() => {
    banco.riga = rigaRecensione();
    banco.tabelle = {};
  });

  it('recensione di un prodotto: testo, voto, «di un prodotto» e il link al prodotto', async () => {
    banco.tabelle.reviews = { product_id: 'prod-9', rating: 1, comment: 'Truffa, non comprate', created_at: '2026-11-19T08:00:00Z' };
    const { box, root } = await disegna();
    await aspettaTesto(box, 'Truffa, non comprate');
    expect(box.textContent).toContain('Recensione di un prodotto · 1/5');
    expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/product/prod-9');
    act(() => root.unmount());
  });

  it('recensione di un negozio: «di un negozio» e il link al negozio', async () => {
    banco.tabelle.store_reviews = { store_id: 'neg-3', rating: 2, comment: 'Mai consegnato', created_at: '2026-11-18T08:00:00Z' };
    const { box, root } = await disegna();
    await aspettaTesto(box, 'Mai consegnato');
    expect(box.textContent).toContain('Recensione di un negozio · 2/5');
    expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/store/neg-3');
    act(() => root.unmount());
  });

  it('una recensione che non c è più lo dice, invece di lasciare solo il codice', async () => {
    const { box, root } = await disegna();
    await aspettaTesto(box, "La recensione non c'è più");
    act(() => root.unmount());
  });
});
