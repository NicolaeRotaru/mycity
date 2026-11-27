/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R01-013 (27/11/2026) — UNA DOMANDA SEGNALATA SI TOGLIE ANCHE DAL PANNELLO DELLE SEGNALAZIONI.
 *
 * La domanda si segnalava già da sola, ma nel pannello «Accolta» era spenta: nessuno poteva
 * toglierla da lì, e l'esito «rimosso» non partiva mai. Ora «Accolta» nasconde la domanda
 * (is_public = false) PRIMA di registrare la decisione; se nasconderla non riesce, la decisione
 * non si salva e l'esito non parte.
 */

const banco = vi.hoisted(() => ({
  passi: [] as string[],
  nascondiFallisce: false,
}));

const RIGA = {
  id: '00000000-0000-4000-8000-000000000099', tipo: 'domanda', oggetto_id: '00000000-0000-4000-8000-0000000000d7',
  motivo: 'odio_o_molestie', dettaglio: 'insulti nella domanda', email_contatto: null, segnalante_id: null,
  stato: 'ricevuta', esito_motivato: null, deciso_at: null, created_at: '2026-11-20T10:00:00Z',
};

function catena(risultato: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'in', 'eq']) c[m] = () => c;
  c.maybeSingle = async () => ({ data: { id: RIGA.oggetto_id }, error: null });
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato()).then(ok, ko);
  return c;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from: (t: string) => ({
      select: () => catena(() => ({ data: t === 'segnalazioni' ? [RIGA] : [], error: null })),
      update: (v: Record<string, unknown>) => catena(() => {
        if (t === 'product_questions') {
          banco.passi.push(`nascondi:${JSON.stringify(v)}`);
          return banco.nascondiFallisce
            ? { data: null, error: { message: 'rete caduta' } }
            : { data: [{ id: RIGA.oggetto_id }], error: null };
        }
        banco.passi.push(`decisione:${String(v.stato)}`);
        return { data: [{ id: RIGA.id }], error: null };
      }),
    }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));

import Pagina from '@/app/admin/segnalazioni/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

async function accogli() {
  globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
    banco.passi.push(`fetch:${init?.method ?? 'GET'} ${String(url)}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
  await flush();
  await vi.waitFor(() => { expect(box.querySelector('li select')).not.toBeNull(); }, { timeout: 5000 });

  const select = box.querySelector('li select') as HTMLSelectElement;
  const opzione = [...select.options].find((o) => o.value === 'accolta')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'accolta');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const area = box.querySelector('li textarea') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'La domanda contiene insulti verso il negozio e viene nascosta.');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = box.querySelector('li form') as HTMLFormElement;
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
  await vi.waitFor(() => { expect(banco.passi.length).toBeGreaterThan(0); }, { timeout: 3000 }).catch(() => {});
  await flush();
  act(() => root.unmount());
  return { opzione };
}

describe('R01-013 · «Accolta» su una domanda la nasconde prima di dire «rimosso»', () => {
  beforeEach(() => { banco.passi.length = 0; banco.nascondiFallisce = false; });

  it('«Accolta» si può scegliere e dice che la domanda viene nascosta', async () => {
    const { opzione } = await accogli();
    expect(opzione.disabled).toBe(false);
    expect(opzione.textContent).toContain('la domanda viene nascosta');
  });

  it('prima si nasconde la domanda, poi si registra la decisione e parte l esito', async () => {
    await accogli();
    const iNascondi = banco.passi.indexOf('nascondi:{"is_public":false}');
    const iDecisione = banco.passi.indexOf('decisione:accolta');
    const iEsito = banco.passi.indexOf('fetch:PATCH /api/segnalazioni');
    expect(iNascondi, `passi: ${banco.passi.join(' | ')}`).toBeGreaterThanOrEqual(0);
    expect(iDecisione).toBeGreaterThan(iNascondi);
    expect(iEsito).toBeGreaterThan(iDecisione);
  });

  it('se nascondere non riesce, niente decisione e niente esito', async () => {
    banco.nascondiFallisce = true;
    await accogli();
    expect(banco.passi).toContain('nascondi:{"is_public":false}');
    expect(banco.passi).not.toContain('decisione:accolta');
    expect(banco.passi.some((p) => p.startsWith('fetch:PATCH'))).toBe(false);
  });
});
