// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * IL MODULO DI RESO NON FA COMPILARE QUELLO CHE IL SERVER RIFIUTA.
 *
 * 1/11/2026 — Due strade in cui il cliente compilava tutto e poi la rotta
 * app/api/returns/create diceva no:
 * - la scadenza: la pagina arrotondava per difetto (14,3 giorni → «14», ancora
 *   dentro), la rotta conta i giorni con la virgola (14,3 > 14 → scaduto); e
 *   senza data di consegna la pagina non poneva limiti, la rotta conta dall'ordine;
 * - il ripensamento sul pane: «Ho cambiato idea» si offriva anche se tutti i
 *   prodotti sono esclusi dal recesso, e la rotta lo rifiuta.
 * Si monta la pagina vera.
 */

const GIORNO = 86_400_000;
const stato = vi.hoisted(() => ({
  ordine: {} as Record<string, unknown>,
  righe: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'o1' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      getUser: async () => ({ data: { user: { id: 'b1' } } }),
    },
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) }) };
      }
      if (tabella === 'order_items') {
        return { select: () => ({ eq: async () => ({ data: stato.righe, error: null }) }) };
      }
      return {
        select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
      };
    },
  },
}));

import NewReturnPage from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let contenitore: HTMLDivElement;

function ordine(campi: Record<string, unknown>) {
  stato.ordine = {
    id: 'o1', total_price: 30, delivery_status: 'DELIVERED', payment_method: 'card',
    stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
    created_at: new Date(Date.now() - 1 * GIORNO).toISOString(),
    delivered_at: new Date(Date.now() - 1 * GIORNO).toISOString(),
    ...campi,
  };
}
const fa = (giorni: number) => new Date(Date.now() - giorni * GIORNO).toISOString();

async function monta() {
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () => root.render(createElement(NewReturnPage)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const modulo = () => /Richiedi un reso/.test(contenitore.textContent ?? '');
const voceRipensamento = () =>
  !!contenitore.querySelector('input[type="radio"][value="CHANGED_MIND"]');

beforeEach(() => {
  stato.righe = [];
  ordine({});
});
afterEach(async () => {
  await act(async () => root.unmount());
  contenitore.remove();
});

describe('la scadenza del modulo e quella del server sono la stessa', () => {
  it('15 giorni e 1 ora dalla consegna: fuori dal 14esimo giorno, niente modulo', async () => {
    ordine({ delivered_at: fa(15 + 1 / 24) });
    await monta();
    expect(modulo()).toBe(false);
    expect(contenitore.textContent).toMatch(/Qui il reso non si può chiedere/);
  });

  it('13 giorni e 20 ore: ancora dentro, il modulo c\'e\'', async () => {
    ordine({ delivered_at: fa(13 + 20 / 24) });
    await monta();
    expect(modulo()).toBe(true);
  });

  it('senza data di consegna si conta dall\'ordine, come il server: 20 giorni fa → scaduto', async () => {
    ordine({ delivered_at: null, created_at: fa(20) });
    await monta();
    expect(modulo()).toBe(false);
  });
});

describe('«Ho cambiato idea» solo dove il server lo accetta', () => {
  it('ordine di solo pane escluso dal recesso: la voce non c\'e\' e la pagina dice perche', async () => {
    stato.righe = [
      { product_id: 'p1', product_name: 'Pane', products: { id: 'p1', name: 'Pane', non_recedibile: true } },
    ];
    await monta();
    expect(modulo()).toBe(true);
    expect(voceRipensamento()).toBe(false);
    expect(contenitore.textContent).toMatch(/la legge non prevede il recesso/);
  });

  it('pane + miele: il ripensamento resta (il miele il recesso ce l\'ha)', async () => {
    stato.righe = [
      { product_id: 'p1', product_name: 'Pane', products: { id: 'p1', name: 'Pane', non_recedibile: true } },
      { product_id: 'p2', product_name: 'Miele', products: { id: 'p2', name: 'Miele', non_recedibile: false } },
    ];
    await monta();
    expect(voceRipensamento()).toBe(true);
  });

  it('prima della migrazione 180 (colonna assente): la voce resta', async () => {
    stato.righe = [{ product_id: 'p1', product_name: 'Pane', products: { id: 'p1', name: 'Pane' } }];
    await monta();
    expect(voceRipensamento()).toBe(true);
  });
});
