/**
 * @vitest-environment jsdom
 *
 * R02-003 (12/11/2026, dopo il QA) — «Accolta» su un negozio: lo sospende solo se è approvato (un
 * negozio già sospeso non blocca più la decisione); su una recensione l'opzione è spenta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RIGA: Record<string, unknown> = {
  id: '00000000-0000-4000-8000-000000000042', tipo: 'negozio', oggetto_id: '00000000-0000-4000-8000-0000000000aa',
  motivo: 'contraffatto', dettaglio: 'marchio falso', email_contatto: 'maria@example.it', segnalante_id: null,
  stato: 'ricevuta', esito_motivato: null, deciso_at: null, created_at: '2026-11-01T10:00:00Z',
};
const aggiornamenti: unknown[] = [];
const negozio = { approval_status: 'approved' };

function catena(risultato: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'in', 'eq']) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
  return c;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from: (t: string) => ({
      select: () => {
        if (t === 'profiles') {
          const c = catena({ data: negozio, error: null });
          (c as Record<string, unknown>).maybeSingle = async () => ({ data: negozio, error: null });
          return c;
        }
        return catena({ data: [RIGA], error: null });
      },
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

async function apri() {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
  await flush();
  await vi.waitFor(() => { if (!box.querySelector('li select')) throw new Error('scheda non ancora disegnata'); }, { timeout: 5000 });
  return { box, root };
}

async function accogli() {
  const chiamate: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
    chiamate.push({ url: String(url), method: init?.method });
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;
  window.confirm = () => true;
  const { box, root } = await apri();
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
  await vi.waitFor(() => { if (!aggiornamenti.length) throw new Error('decisione non ancora salvata'); }, { timeout: 3000 }).catch(() => {});
  await flush();
  act(() => root.unmount());
  return chiamate;
}

describe('R02-003 · «Accolta» su negozi e recensioni', () => {
  beforeEach(() => { aggiornamenti.length = 0; RIGA.tipo = 'negozio'; });

  it('negozio approvato: si sospende, poi si registra e parte l esito', async () => {
    negozio.approval_status = 'approved';
    const chiamate = await accogli();
    expect(chiamate.some((c) => /\/api\/admin\/users\/.+\/moderate/.test(c.url))).toBe(true);
    expect(aggiornamenti).toHaveLength(1);
  });

  it('negozio già sospeso: niente seconda sospensione, la decisione si registra lo stesso', async () => {
    negozio.approval_status = 'suspended';
    const chiamate = await accogli();
    expect(chiamate.some((c) => c.url.includes('/moderate'))).toBe(false);
    expect(aggiornamenti).toHaveLength(1);
  });

  it('recensione: «Accolta» è spenta', async () => {
    RIGA.tipo = 'recensione';
    const { box, root } = await apri();
    const opzione = box.querySelector('li select option[value="accolta"]') as HTMLOptionElement;
    expect(opzione.disabled).toBe(true);
    act(() => root.unmount());
  });
});
