/**
 * @vitest-environment jsdom
 *
 * R02-003 (12/11/2026) — Dalla pagina, «Accolta» su un prodotto passa prima dalla rotta che lo
 * toglie; se togliere non riesce, la decisione non si salva e l'esito «rimosso» non parte.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RIGA = {
  id: '00000000-0000-4000-8000-000000000042', tipo: 'prodotto', oggetto_id: '00000000-0000-4000-8000-0000000000aa',
  motivo: 'contraffatto', dettaglio: 'marchio falso', email_contatto: 'maria@example.it', segnalante_id: null,
  stato: 'ricevuta', esito_motivato: null, deciso_at: null, created_at: '2026-11-01T10:00:00Z',
};
const aggiornamenti: unknown[] = [];

function catena(risultato: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'in', 'eq']) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
  return c;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from: () => ({
      select: () => catena({ data: [RIGA], error: null }),
      update: (v: unknown) => { aggiornamenti.push(v); return catena({ data: [{ id: RIGA.id }], error: null }); },
    }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));

import Pagina from '@/app/admin/segnalazioni/page';

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

async function accogli(accogliRiesce: boolean) {
  const chiamate: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
    chiamate.push({ url: String(url), method: init?.method });
    const ok = !String(url).includes('/accogli') || accogliRiesce;
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 500 });
  }) as unknown as typeof fetch;

  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
  await flush();
  await vi.waitFor(() => { if (!box.querySelector('li select')) throw new Error('scheda non ancora disegnata'); }, { timeout: 5000 });

  const select = box.querySelector('li select') as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'accolta');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const area = box.querySelector('li textarea') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'Il prodotto riporta un marchio non autorizzato e viene rimosso.');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = box.querySelector('li form') as HTMLFormElement;
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
  await vi.waitFor(() => { if (!chiamate.length) throw new Error('niente partito'); }, { timeout: 5000 }).catch(() => {});
  await flush();
  act(() => root.unmount());
  return chiamate;
}

describe('R02-003 · «Accolta» dalla pagina toglie il prodotto prima di dire «rimosso»', () => {
  beforeEach(() => { aggiornamenti.length = 0; });

  it('prima si toglie il prodotto, poi si registra la decisione e parte l esito', async () => {
    const chiamate = await accogli(true);
    const iTolto = chiamate.findIndex((c) => c.url.includes('/api/admin/segnalazioni/accogli'));
    const iEsito = chiamate.findIndex((c) => c.url === '/api/segnalazioni' && c.method === 'PATCH');
    expect(iTolto, 'il prodotto deve essere tolto').toBeGreaterThanOrEqual(0);
    expect(iEsito).toBeGreaterThan(iTolto);
    expect(aggiornamenti).toHaveLength(1);
  });

  it('se togliere non riesce, niente decisione e niente esito «rimosso»', async () => {
    const chiamate = await accogli(false);
    expect(aggiornamenti).toHaveLength(0);
    expect(chiamate.some((c) => c.url === '/api/segnalazioni' && c.method === 'PATCH')).toBe(false);
  });
});
