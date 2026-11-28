// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R04-001 (27/11/2026) — LA PAGINA DEL RESO NON OFFRE «HO CAMBIATO IDEA» SUL PANE NON SPUNTATO.
 *
 * La pagina chiedeva a /api/returns/ripensamento, che guardava solo la spunta del negozio: per un
 * pane del Panificio mai spuntato rispondeva «nessun rifiuto» (qui il finto risponde come lei), la
 * pagina lasciava il motivo e il rifiuto arrivava solo all'invio. E chiedeva per tutto l'ordine:
 * scelta la sola riga del pane in un ordine misto, il motivo restava offerto.
 * Ora chiede a /api/returns/create, la rotta che decide l'invio, per la riga scelta.
 */
const stato = vi.hoisted(() => ({ ordine: null as unknown, chiamate: [] as string[] }));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'o1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/storage/carica-immagine', () => ({ caricaImmagine: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }), getSession: async () => ({ data: { session: null } }) },
    from: (t: string) =>
      t === 'orders'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) },
  },
}));

import NewReturnPage from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;

const RIGA_PANE = '22222222-2222-4222-8222-222222222222';
const RIGA_MIELE = '33333333-3333-4333-8333-333333333333';
const RIFIUTO = 'Questo prodotto (Pane casereccio) è escluso dal recesso: è fresco o fatto su ordinazione, e la legge non permette il reso per «Cambio idea» (art. 59 del Codice del Consumo).';
const riga = (id: string, nome: string) => ({ id, quantity: 1, unit_price: 3, product_name: nome, products: null });
function ordine(righe: unknown[]) {
  return {
    id: 'o1', total_price: 8, delivery_status: 'DELIVERED',
    delivered_at: new Date(Date.now() - 86_400_000).toISOString(), created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
    order_items: righe,
  };
}

const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(NewReturnPage)));
  for (let i = 0; i < 4; i++) await pausa();
}
const radio = (name: string, value: string) => c.querySelector(`input[type=radio][name=${name}][value="${value}"]`) as HTMLInputElement;
const ripensamento = () => radio('reason', 'CHANGED_MIND');
async function clicca(el: HTMLInputElement) {
  await act(async () => { el.click(); });
  for (let i = 0; i < 4; i++) await pausa();
}

beforeEach(() => {
  stato.chiamate = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    stato.chiamate.push(url);
    const u = new URL(url, 'http://localhost');
    // Il server vero (tests/unit/riparazione-r04-reso-pane-domanda.test.ts): il pane non spuntato
    // del Panificio e' escluso, da solo o come unico prodotto dell'ordine; il miele no.
    // /api/returns/ripensamento guardava solo la spunta: per il pane mai spuntato, nessun rifiuto.
    let rifiuto: string | null = null;
    if (u.pathname === '/api/returns/create') {
      const item = u.searchParams.get('orderItemId');
      const soloPane = (stato.ordine as { order_items: Array<{ id: string }> }).order_items.every((r) => r.id === RIGA_PANE);
      rifiuto = item === RIGA_PANE || (!item && soloPane) ? RIFIUTO : null;
    }
    return new Response(JSON.stringify({ ok: true, rifiuto }), { status: 200 });
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.unstubAllGlobals();
});

describe('R04-001 · «Ho cambiato idea» non si offre sul pane che il forno non ha spuntato', () => {
  it('ordine di solo pane: scelto il motivo, la scelta si toglie, si spegne e la pagina dice perché', async () => {
    stato.ordine = ordine([riga(RIGA_PANE, 'Pane casereccio')]);
    await monta();
    await clicca(ripensamento());
    expect(ripensamento().checked, 'la pagina offre ancora il ripensamento sul pane').toBe(false);
    expect(ripensamento().disabled).toBe(true);
    expect(c.textContent).toMatch(/art\. 59/);
    expect(radio('reason', 'DAMAGED').disabled, 'il difetto resta sempre possibile').toBe(false);
  });

  it('ordine misto, scelta la sola riga del pane: il motivo si spegne; scelto il miele torna offerto', async () => {
    stato.ordine = ordine([riga(RIGA_PANE, 'Pane casereccio'), riga(RIGA_MIELE, 'Miele di acacia')]);
    await monta();
    await clicca(radio('articolo', RIGA_PANE));
    await clicca(ripensamento());
    expect(stato.chiamate.some((u) => u.includes(`orderItemId=${RIGA_PANE}`)), 'la pagina non chiede per la riga scelta').toBe(true);
    expect(ripensamento().disabled, 'la pagina offre il ripensamento sulla riga del pane').toBe(true);
    expect(ripensamento().checked).toBe(false);

    await clicca(radio('articolo', RIGA_MIELE));
    expect(ripensamento().disabled).toBe(false);
    await clicca(ripensamento());
    expect(ripensamento().checked).toBe(true);
    expect(c.textContent).not.toMatch(/art\. 59/);
  });
});
