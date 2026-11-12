// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R07-006 (12/11/2026) — la pagina del reso usa la stessa regola del server.
 * Prima arrotondava per difetto: l'ultimo giorno e il giorno dopo faceva compilare
 * tutto il modulo, IBAN compreso, e poi il server lo rifiutava come scaduto.
 * E senza data di consegna non contava dalla data dell'ordine, come fa il server.
 */
const stato = vi.hoisted(() => ({ lettura: { data: null as unknown, error: null as unknown } }));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'o1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }), getSession: async () => ({ data: { session: null } }) },
    from: (t: string) =>
      t === 'orders'
        ? { select: () => ({ eq: () => ({ single: async () => stato.lettura }) }) }
        : { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) },
  },
}));

import NewReturnPage from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function monta(ora: string, deliveredAt: string | null, createdAt = '2026-02-01T10:00:00Z') {
  vi.setSystemTime(new Date(ora));
  stato.lettura = {
    data: {
      id: 'o1', total_price: 30, delivery_status: 'DELIVERED', delivered_at: deliveredAt, created_at: createdAt,
      payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
    },
    error: null,
  };
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(NewReturnPage)));
  await pausa();
  await pausa();
}
const chiuso = () => /Qui il reso non si può chiedere/.test(c.textContent ?? '');
const modulo = () => c.querySelectorAll('input[type=radio]').length > 0;

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.useRealTimers();
});

describe('R07-006 · la pagina del reso dice scaduto quando il server lo direbbe', () => {
  it('il giorno dopo l ultimo (16/3 alle 08:00, consegna 1/3 alle 20) il modulo non si apre', async () => {
    // 15 giorni di calendario, ma solo 14 giorni e 12 ore di orologio: prima la pagina lasciava compilare.
    await monta('2026-03-16T07:00:00Z', '2026-03-01T19:00:00Z');
    expect(chiuso()).toBe(true);
    expect(modulo()).toBe(false);
  });

  it('l ultimo giorno, la sera (15/3 alle 21, consegna 1/3 alle 10), il modulo c è', async () => {
    await monta('2026-03-15T20:00:00Z', '2026-03-01T09:00:00Z');
    expect(chiuso()).toBe(false);
    expect(modulo()).toBe(true);
  });

  it('senza data di consegna conta dalla data dell ordine, come il server', async () => {
    await monta('2026-03-01T10:00:00Z', null, '2026-02-01T10:00:00Z');
    expect(chiuso()).toBe(true);
    expect(modulo()).toBe(false);
  });
});
