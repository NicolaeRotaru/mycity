/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';
import { statoDellaPromo } from '@/app/seller/promotions/stato-promo';

/**
 * R18-004 — Nello storico delle promo una promo annullata si leggeva «Terminata 06/12/2026 ·
 * Annullata»: l'annullamento cambia solo lo stato e lascia ends_at, e la riga scriveva sempre
 * «Terminata <ends_at>», anche quando quella data deve ancora venire.
 *
 * Orologio finto al 6/11/2026. La promo annullata durava fino al 6/12: nello storico resta
 * «Annullata» e non compare nessuna «Terminata». Una promo scaduta davvero tiene la sua data.
 */

type Op = { tabella: string; azione: string };
const stato: { promo: unknown[] } = { promo: [] };

function costruttore(tabella: string) {
  const op: Op = { tabella, azione: 'select' };
  const esito = () => (tabella === 'seller_promotions' && op.azione === 'select' ? { data: stato.promo, error: null } : { data: [], error: null });
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'or', 'in', 'eq', 'neq']) q[m] = () => q;
  q.insert = () => { op.azione = 'insert'; return q; };
  q.update = () => { op.azione = 'update'; return q; };
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esito()).then(ok, ko);
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'anna@example.com' } }, error: null }) },
    from: (t: string) => costruttore(t),
  },
}));
vi.mock('next/navigation', () => {
  const rotta = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
  return { useRouter: () => rotta };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return ce('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));

async function aspetta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function conQuery(Pagina: ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Avvolta() {
    return createElement(QueryClientProvider, { client }, createElement(Pagina));
  };
}

const ADESSO = new Date('2026-11-06T10:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  stato.promo = [
    { id: 'p-annullata', title: 'Saldi di dicembre', discount_percent: 15, scope: 'store', starts_at: '2026-11-01T09:00:00Z', ends_at: '2026-12-06T12:00:00Z', status: 'cancelled' },
    { id: 'p-scaduta', title: 'Festa di ottobre', discount_percent: 20, scope: 'store', starts_at: '2026-10-25T09:00:00Z', ends_at: '2026-11-01T12:00:00Z', status: 'active' },
  ];
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function rigaDelloStorico(titolo: string): string {
  const riga = Array.from(document.querySelectorAll('p')).find((el) => el.textContent === titolo)?.parentElement?.parentElement;
  expect(riga, `nello storico manca «${titolo}»`).toBeTruthy();
  return riga!.textContent ?? '';
}

describe('R18-004 — lo storico non dice «Terminata» con una data che deve ancora venire', () => {
  it('lo stato con l’orologio finto: annullata prima della fine, scaduta dopo', () => {
    expect(statoDellaPromo({ status: 'cancelled', ends_at: '2026-12-06T12:00:00Z' })).toBe('Annullata');
    expect(statoDellaPromo({ status: 'active', ends_at: '2026-11-01T12:00:00Z' })).toBe('Scaduta');
  });

  it('la promo annullata il 6/11 che durava fino al 6/12 si legge «Annullata», senza «Terminata 6/12/2026»', async () => {
    const { default: Pagina } = await import('@/app/seller/promotions/page');
    const s = accendi(conQuery(Pagina as ComponentType));
    await aspetta();
    const annullata = rigaDelloStorico('Saldi di dicembre');
    expect(annullata).toContain('Annullata');
    expect(annullata).not.toContain('Terminata');
    expect(annullata).not.toContain('2026');
    const scaduta = rigaDelloStorico('Festa di ottobre');
    expect(scaduta).toContain('Terminata 01/11/2026');
    expect(scaduta).toContain('Scaduta');
    s.smonta();
  });
});
