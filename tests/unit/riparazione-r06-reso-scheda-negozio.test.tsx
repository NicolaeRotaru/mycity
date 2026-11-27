// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { queryKeys } from '@/lib/queries/keys';

/**
 * R06 — La scheda del reso nel pannello del negozio. Tre articoli per 45 € più 3 € di consegna:
 * il cliente rende il vasetto da 5 €.
 * · la scheda dice quale articolo torna;
 * · l'importo proposto è il prezzo di quell'articolo, non il totale con la spedizione;
 * · «Approva reso» non rimborsa subito solo perché l'importo è scritto nel campo: il rimborso
 *   immediato è una spunta da mettere apposta.
 */
const ID = '11111111-2222-3333-4444-555555555555';
const RIGA_VASETTO = '33333333-3333-4333-8333-333333333333';
const RIGHE = [
  { id: '11111111-1111-4111-8111-111111111111', quantity: 1, unit_price: 20, product_name: 'Miele di acacia', product_image: null, products: null },
  { id: '22222222-2222-4222-8222-222222222222', quantity: 1, unit_price: 20, product_name: 'Olio nuovo', product_image: null, products: null },
  { id: RIGA_VASETTO, quantity: 1, unit_price: 5, product_name: 'Vasetto di marmellata', product_image: null, products: null },
];
const RESO = {
  id: 'r1', status: 'REQUESTED', reason: 'DAMAGED', notes: 'il vasetto è rotto', photo_urls: [], refund_amount_cents: null,
  decision_notes: null, created_at: '2026-11-20T10:00:00Z', order_item_id: RIGA_VASETTO, decided_at: null,
};

const chiamate = vi.hoisted(() => [] as Array<{ url: string; corpo: Record<string, unknown> }>);

vi.mock('react', async (orig) => {
  const vero = await orig<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (o: { mutationFn: (v: unknown) => Promise<unknown> }) => ({
    mutate: (v: unknown) => { void o.mutationFn(v).catch(() => undefined); },
    isPending: false,
  }),
  useQuery: (o: { queryKey: unknown[] }) => {
    const k = JSON.stringify(o.queryKey);
    if (k === JSON.stringify(queryKeys.seller.order(ID))) {
      return {
        data: {
          id: ID, user_id: 'b1', delivery_status: 'DELIVERED', created_at: '2026-11-18T09:00:00Z',
          delivered_at: '2026-11-18T12:00:00Z', pickup_in_store: false, total_price: 48, shipping_cost: 3,
          payment_method: 'card', delivery_slot: null, order_items: RIGHE, rider: null, seller: null,
        },
        isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: 0, errorUpdatedAt: 0,
      };
    }
    if (k === JSON.stringify(queryKeys.seller.returnForOrder(ID))) {
      return { data: RESO, isLoading: false, isError: false, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));

const { default: ReturnRequestCard } = await import('@/components/seller/ReturnRequestCard');
const { default: PaginaOrdine } = await import('@/app/seller/orders/[id]/page');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let c: HTMLDivElement;

beforeEach(() => {
  chiamate.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    chiamate.push({ url, corpo: init?.body ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  c?.remove();
  vi.unstubAllGlobals();
});

const scheda = () =>
  createElement(ReturnRequestCard, { ret: RESO as never, orderTotal: 48, righe: RIGHE, onDecided: () => {} } as never);

describe('la scheda del reso dice cosa torna e propone quanto vale', () => {
  it('mostra l articolo e propone 5 €, non 48 €', () => {
    const html = renderToStaticMarkup(scheda());
    expect(html).toContain('Vasetto di marmellata');
    expect(html).toContain('value="5.00"');
    expect(html).not.toContain('value="48.00"');
    expect(html).not.toContain('Lascia il totale per rimborsare tutto subito');
  });

  it('con un codice sconto sull ordine l articolo porta la sua parte: 4,50 € su 4,50 € di sconto', () => {
    const html = renderToStaticMarkup(
      createElement(ReturnRequestCard, { ret: RESO as never, orderTotal: 43.5, righe: RIGHE, scontoCents: 450, onDecided: () => {} } as never),
    );
    expect(html).toContain('value="4.50"');
  });

  it('se l ordine ha un solo articolo, torna tutto: si propone il totale con la consegna', () => {
    const html = renderToStaticMarkup(
      createElement(ReturnRequestCard, {
        ret: RESO as never, orderTotal: 8, righe: [RIGHE[2]], onDecided: () => {},
      } as never),
    );
    expect(html).toContain('value="8.00"');
    expect(html).toContain('Vasetto di marmellata');
  });

  it('nella pagina dell ordine la scheda riceve le righe: stesso articolo, stesso importo', () => {
    const html = renderToStaticMarkup(
      createElement(PaginaOrdine, { params: { valore: { id: ID } } as unknown as Promise<{ id: string }> }),
    );
    expect(html).toContain('Richiesta di reso');
    expect(html).toMatch(/Cosa torna:.*Vasetto di marmellata/);
    expect(html).toContain('value="5.00"');
  });
});

describe('il rimborso subito è una scelta esplicita', () => {
  async function monta() {
    c = document.createElement('div');
    document.body.appendChild(c);
    root = createRoot(c);
    await act(async () => root?.render(scheda()));
  }
  const approva = () =>
    Array.from(c.querySelectorAll('button')).find((b) => /Approva reso/.test(b.textContent ?? '')) as HTMLButtonElement;

  it('«Approva reso» col campo già scritto approva e basta: niente rimborso prima che torni la merce', async () => {
    await monta();
    await act(async () => { approva().click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const decisione = chiamate.find((x) => x.url === '/api/returns/r1/decide');
    expect(decisione?.corpo.decision).toBe('APPROVED');
    expect(decisione?.corpo.refundAmountCents, 'il rimborso parte da solo all approvazione').toBeUndefined();
  });

  it('con la spunta «Rimborsa subito» parte il rimborso dell importo scritto', async () => {
    await monta();
    const spunta = Array.from(c.querySelectorAll('input[type=checkbox]')).find((i) =>
      /Rimborsa subito/.test(i.closest('label')?.textContent ?? ''),
    ) as HTMLInputElement | undefined;
    expect(spunta, 'manca la scelta esplicita del rimborso subito').toBeDefined();
    await act(async () => { spunta?.click(); });
    await act(async () => { approva().click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const decisione = chiamate.find((x) => x.url === '/api/returns/r1/decide');
    expect(decisione?.corpo).toMatchObject({ decision: 'APPROVED', refundAmountCents: 500 });
  });
});
