// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R07-017 (12/11/2026) — la pagina admin del Drop del giorno (funzione spenta, da
 * sistemare prima di riaccenderla):
 *  · usava il giorno di Greenwich: fra mezzanotte e l'una-due di notte, ora di
 *    Piacenza, la data minima del modulo e l'elenco dei drop erano su ieri;
 *  · leggeva i drop senza guardare l'errore, e una lettura caduta diceva «Nessun drop».
 * (La classifica inviti guardava già l'errore dal 5/11.)
 */
const stato = vi.hoisted(() => ({ gte: [] as unknown[], dropsInErrore: false }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      const passa = () => b;
      Object.assign(b, {
        select: passa, eq: passa, order: passa, limit: passa,
        gte: (_c: string, v: unknown) => { stato.gte.push(v); return b; },
        then: (ok: (r: unknown) => unknown) =>
          Promise.resolve(
            t === 'daily_drops' && stato.dropsInErrore ? { data: null, error: { message: 'rete giù' } } : { data: [], error: null },
          ).then(ok),
      });
      return b;
    },
  },
}));

import AdminDailyDropsPage from '@/app/admin/daily-drops/page';

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

beforeEach(() => {
  stato.gte = [];
  stato.dropsInErrore = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  // Il 13 novembre alle 00:30 a Piacenza: a Greenwich è ancora il 12.
  vi.setSystemTime(new Date('2026-11-12T23:30:00Z'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.useRealTimers();
});

describe('R07-017 · il Drop del giorno conta il giorno di Piacenza e non scambia un errore per «nessun drop»', () => {
  it('alle 00:30 del 13/11 la data minima, quella proposta e l elenco partono dal 13', async () => {
    await monta();
    const data = c.querySelector('input[type=date]') as HTMLInputElement;
    expect(data.min).toBe('2026-11-13');
    expect(data.value).toBe('2026-11-13');
    expect(stato.gte).toContain('2026-11-13');
    expect(stato.gte).not.toContain('2026-11-12');
  });

  it('con la lettura dei drop caduta non dice «Nessun drop», offre di riprovare', async () => {
    stato.dropsInErrore = true;
    await monta();
    expect(c.textContent).not.toContain('Nessun drop');
    expect(c.textContent).toContain('Non riesco a leggere i drop programmati');
  });
});
