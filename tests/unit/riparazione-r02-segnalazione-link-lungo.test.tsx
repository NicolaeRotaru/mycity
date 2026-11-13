/**
 * @vitest-environment jsdom
 *
 * R02-021 (12/11/2026) — Nelle segnalazioni un link lungo incollato da chi segnala va a capo
 * dentro la scheda invece di allargare la pagina sul telefono.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RIGA = {
  id: '00000000-0000-4000-8000-000000000042', tipo: 'prodotto', oggetto_id: '00000000-0000-4000-8000-0000000000aa',
  motivo: 'contraffatto', dettaglio: 'Vedi https://www.esempio-di-negozio-falso.it/prodotti/borsa-originale-firmata-marchio-registrato-2026?ref=abcdefghijklmnopqrstuvwxyz', email_contatto: 'maria@example.it', segnalante_id: null,
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

describe('R02-021 · il dettaglio della segnalazione va a capo', () => {
  it('il paragrafo del dettaglio spezza le parole lunghe', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))); });
    await flush();
    await vi.waitFor(() => { if (!box.textContent?.includes('esempio-di-negozio-falso')) throw new Error('scheda non ancora disegnata'); }, { timeout: 5000 });
    const p = [...box.querySelectorAll('p')].find((x) => x.textContent?.includes('esempio-di-negozio-falso'))!;
    expect(p.className).toMatch(/break-words|overflow-wrap:anywhere/);
    act(() => root.unmount());
  });
});
