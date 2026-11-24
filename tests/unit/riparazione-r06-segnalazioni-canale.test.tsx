/**
 * @vitest-environment jsdom
 *
 * R06-014 — Dopo un errore su un solo canale la pagina delle segnalazioni nomina il canale caduto,
 * invece di dire che l'esito non è partito né a chi ha segnalato né al venditore.
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
const errori: string[] = [];

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
      update: () => catena({ data: [{ id: RIGA.id }], error: null }),
    }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => { errori.push(m); } } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));

import Pagina from '@/app/admin/segnalazioni/page';

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

describe('R06-014 · il messaggio dice quale canale non è partito', () => {
  it('con solo il venditore caduto, il messaggio nomina il venditore e non chi ha segnalato', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'fallita' }), { status: 502 })
    ) as unknown as typeof fetch;

    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
    await flush();
    await vi.waitFor(() => { if (!box.querySelector('li select')) throw new Error('scheda non ancora disegnata'); }, { timeout: 5000 });

    const select = box.querySelector('li select') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'respinta');
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
    await vi.waitFor(() => { if (!errori.length) throw new Error('messaggio non ancora mostrato'); }, { timeout: 5000 });

    expect(errori[0]).toContain('avviso al venditore');
    expect(errori[0]).not.toContain('a chi ha segnalato');
    act(() => root.unmount());
  });
});
