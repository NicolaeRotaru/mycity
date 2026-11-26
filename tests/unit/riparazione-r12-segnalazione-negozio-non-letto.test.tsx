/**
 * @vitest-environment jsdom
 *
 * R12-009 — Accogliendo la segnalazione di un negozio, se la lettura del negozio cadeva, il
 * negozio restava online ma la decisione «accolta» si registrava.
 *
 * La pagina legge lo stato del negozio per sapere se sospenderlo. L'errore della lettura non lo
 * guardava nessuno: un negozio «non letto» valeva come «non approvato», la sospensione si
 * saltava e la segnalazione si chiudeva come accolta, con l'esito «rimosso» in partenza.
 * Adesso una lettura caduta ferma tutto: niente sospensione a meta', niente decisione, niente esito.
 * Client Supabase finto, fetch finto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RIGA: Record<string, unknown> = {
  id: '00000000-0000-4000-8000-000000001209', tipo: 'negozio', oggetto_id: '00000000-0000-4000-8000-0000000012aa',
  motivo: 'contraffatto', dettaglio: 'marchio falso', email_contatto: null, segnalante_id: null,
  stato: 'ricevuta', esito_motivato: null, deciso_at: null, created_at: '2026-11-20T10:00:00Z',
};
const aggiornamenti: unknown[] = [];
let letturaNegozio: { data: unknown; error: unknown } = { data: null, error: null };

function catena(risultato: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'in', 'eq']) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
  return c;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-r12' } } }) },
    from: (t: string) => ({
      select: () => {
        if (t === 'profiles') {
          const c = catena(letturaNegozio);
          (c as Record<string, unknown>).maybeSingle = async () => letturaNegozio;
          return c;
        }
        return catena({ data: [RIGA], error: null });
      },
      update: (v: unknown) => { aggiornamenti.push(v); return catena({ data: [{ id: RIGA.id }], error: null }); },
    }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
const toastErrore = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: unknown) => toastErrore(m) } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));

import Pagina from '@/app/admin/segnalazioni/page';

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

async function accogli() {
  const chiamate: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
    chiamate.push({ url: String(url), method: init?.method });
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;
  window.confirm = () => true;
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
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'Il negozio vende merce contraffatta, verificato con il titolare del marchio.');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { (box.querySelector('li form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
  // Si aspetta che la decisione finisca, in un modo o nell'altro: salvata o rifiutata con un messaggio.
  await vi.waitFor(() => { if (!aggiornamenti.length && !toastErrore.mock.calls.length) throw new Error('decisione ancora in corso'); }, { timeout: 3000 }).catch(() => {});
  await flush();
  act(() => root.unmount());
  return chiamate;
}

describe('R12-009 — «Accolta» su un negozio quando la lettura del negozio cade', () => {
  beforeEach(() => { aggiornamenti.length = 0; toastErrore.mockReset(); });

  it('la lettura cade: la decisione non si registra, nessun esito parte, e la pagina lo dice', async () => {
    letturaNegozio = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const chiamate = await accogli();
    expect(aggiornamenti, '«accolta» registrata col negozio non letto (e quindi ancora online)').toHaveLength(0);
    expect(chiamate.some((c) => c.url === '/api/segnalazioni'), 'esito partito senza sospensione').toBe(false);
    expect(chiamate.some((c) => c.url.includes('/moderate'))).toBe(false);
    expect(toastErrore).toHaveBeenCalled();
    expect(String(toastErrore.mock.calls[0][0])).toMatch(/negozio/i);
  });

  it('la lettura riesce e il negozio e online: si sospende, poi si registra', async () => {
    letturaNegozio = { data: { approval_status: 'approved' }, error: null };
    const chiamate = await accogli();
    expect(chiamate.some((c) => /\/api\/admin\/users\/.+\/moderate/.test(c.url))).toBe(true);
    expect(aggiornamenti).toHaveLength(1);
  });
});
