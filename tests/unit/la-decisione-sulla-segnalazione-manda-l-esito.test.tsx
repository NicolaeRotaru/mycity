/**
 * @vitest-environment jsdom
 *
 * Collaudo B (S3): l'amministratore registra «accolta» con la motivazione dalla
 * pagina /admin/segnalazioni. Atteso: parte la comunicazione dell'esito
 * (PATCH /api/segnalazioni con l'id). Se la pagina scrive solo sul database,
 * a chi ha segnalato e al venditore non arriva niente.
 */
import { describe, it, expect, vi } from 'vitest';
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

describe('la decisione registrata dalla pagina admin fa partire l esito', () => {
  it('dopo «Registra la decisione» parte PATCH /api/segnalazioni con l id', async () => {
    const chiamate: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
      chiamate.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
    await flush();

    const select = box.querySelector('li select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      set.call(select, 'accolta');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const area = box.querySelector('li textarea') as HTMLTextAreaElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(area, 'Il prodotto riporta un marchio non autorizzato e viene rimosso.');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = box.querySelector('li form') as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();

    // la decisione e' stata scritta sul database...
    expect(aggiornamenti).toHaveLength(1);
    // ...e l'esito deve partire verso chi ha segnalato e il venditore
    expect(chiamate.some((c) => c.url.includes('/api/segnalazioni') && c.method === 'PATCH')).toBe(true);
    act(() => root.unmount());
  });
});
