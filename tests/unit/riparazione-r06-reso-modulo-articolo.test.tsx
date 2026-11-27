// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R06 — Il modulo del reso fa scegliere l'articolo. Il cliente ha comprato tre articoli per
 * 45 € e uno, da 5 €, è arrivato rotto: il reso deve dire quale, non valere per tutto l'ordine.
 * La rotta e il database hanno già `order_item_id`; il modulo non lo mandava mai.
 *
 * Finti sul modello di tests/unit/minori-s02-reso.test.tsx.
 */
const stato = vi.hoisted(() => ({
  lettura: { data: null as unknown, error: null as unknown },
  chiamate: [] as Array<{ url: string; corpo: Record<string, unknown> }>,
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'o1' }), useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/storage/carica-immagine', () => ({ caricaImmagine: vi.fn() }));
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

const RIGA_VASETTO = '33333333-3333-4333-8333-333333333333';
const ORDINE = {
  id: 'o1', total_price: 48, delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
  order_items: [
    { id: '11111111-1111-4111-8111-111111111111', quantity: 1, unit_price: 20, product_name: 'Miele di acacia', products: null },
    { id: '22222222-2222-4222-8222-222222222222', quantity: 1, unit_price: 20, product_name: 'Olio nuovo', products: null },
    { id: RIGA_VASETTO, quantity: 1, unit_price: 5, product_name: 'Vasetto di marmellata', products: null },
  ],
};
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(NewReturnPage)));
  await pausa();
  await pausa();
}
const invia = () =>
  Array.from(c.querySelectorAll('button')).find((b) => /Invia richiesta|Scegli/.test(b.textContent ?? '')) as HTMLButtonElement;
const radio = (name: string, value: string) =>
  c.querySelector(`input[type=radio][name=${name}][value="${value}"]`) as HTMLInputElement | null;

beforeEach(() => {
  stato.lettura = { data: ORDINE, error: null };
  stato.chiamate = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    stato.chiamate.push({ url, corpo: init?.body ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ id: 'r1' }), { status: 201 });
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.unstubAllGlobals();
});

describe('il modulo del reso fa scegliere l articolo', () => {
  it('il reso del vasetto rotto manda quale articolo torna', async () => {
    await monta();
    const vasetto = radio('articolo', RIGA_VASETTO);
    expect(vasetto, 'il modulo non fa scegliere quale articolo si rende').not.toBeNull();
    await act(async () => { vasetto?.click(); });
    await act(async () => { radio('reason', 'DAMAGED')?.click(); });
    await act(async () => { invia().click(); });
    const creazione = stato.chiamate.find((x) => x.url === '/api/returns/create');
    expect(creazione?.corpo).toMatchObject({ orderId: 'o1', orderItemId: RIGA_VASETTO, reason: 'DAMAGED' });
  });

  it('con più articoli non parte niente finché non si sceglie cosa rendere', async () => {
    await monta();
    await act(async () => { radio('reason', 'DAMAGED')?.click(); });
    expect(invia().disabled, 'il reso parte senza dire cosa torna: varrebbe per tutto l ordine').toBe(true);
    expect(invia().textContent).toMatch(/Scegli cosa vuoi rendere/);
  });

  it('«Tutto l ordine» resta una scelta, e allora l articolo non si manda', async () => {
    await monta();
    const tutto = radio('articolo', 'tutto');
    expect(tutto, 'manca la scelta «Tutto l ordine»').not.toBeNull();
    await act(async () => { tutto?.click(); });
    await act(async () => { radio('reason', 'DAMAGED')?.click(); });
    await act(async () => { invia().click(); });
    const creazione = stato.chiamate.find((x) => x.url === '/api/returns/create');
    expect(creazione?.corpo.orderId).toBe('o1');
    expect(creazione?.corpo.orderItemId).toBeUndefined();
  });
});
