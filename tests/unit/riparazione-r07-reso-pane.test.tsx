// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R07-002 (12/11/2026) — la pagina del reso offriva «Ho cambiato idea» anche su un
 * ordine di solo pane. Il server lo rifiuta (art. 59 Cod. Cons.): la pagina ora
 * spegne la scelta e dice perché. Su un ordine misto la scelta resta.
 */
const stato = vi.hoisted(() => ({
  righe: [] as Array<{ product_id: string; product_name: string }>,
  prodotti: [] as Array<{ id: string; name: string; non_recedibile: boolean }>,
}));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'o1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }), getSession: async () => ({ data: { session: null } }) },
    from: (t: string) => {
      if (t === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'o1', total_price: 8, delivery_status: 'DELIVERED',
                  delivered_at: new Date(Date.now() - 86_400_000).toISOString(), created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
                  payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (t === 'order_items') return { select: () => ({ eq: async () => ({ data: stato.righe, error: null }) }) };
      if (t === 'products') return { select: () => ({ in: async () => ({ data: stato.prodotti, error: null }) }) };
      return { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
    },
  },
}));

import NewReturnPage from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(NewReturnPage)));
  for (let i = 0; i < 4; i++) await pausa();
}
const ripensamento = () => c.querySelector('input[type=radio][value=CHANGED_MIND]') as HTMLInputElement;

beforeEach(() => {
  stato.righe = [];
  stato.prodotti = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
});

describe('R07-002 · «Ho cambiato idea» non si offre su un ordine di solo pane', () => {
  it('ordine di solo pane: la scelta è spenta e la pagina dice perché', async () => {
    stato.righe = [{ product_id: 'p1', product_name: 'Pane casereccio' }];
    stato.prodotti = [{ id: 'p1', name: 'Pane casereccio', non_recedibile: true }];
    await monta();
    expect(ripensamento()).toBeTruthy();
    expect(ripensamento().disabled).toBe(true);
    expect(c.textContent).toMatch(/art\. 59/);
    // Gli altri motivi restano: la garanzia vale sempre.
    expect((c.querySelector('input[type=radio][value=DAMAGED]') as HTMLInputElement | null)?.disabled ?? false).toBe(false);
  });

  it('ordine misto (pane + miele): la scelta resta', async () => {
    stato.righe = [
      { product_id: 'p1', product_name: 'Pane casereccio' },
      { product_id: 'p2', product_name: 'Miele' },
    ];
    stato.prodotti = [
      { id: 'p1', name: 'Pane casereccio', non_recedibile: true },
      { id: 'p2', name: 'Miele', non_recedibile: false },
    ];
    await monta();
    expect(ripensamento().disabled).toBe(false);
    expect(c.textContent).not.toMatch(/art\. 59/);
  });
});
