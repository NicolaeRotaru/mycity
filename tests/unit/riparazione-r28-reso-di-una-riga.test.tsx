// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { queryKeys } from '@/lib/queries/keys';
import { importoPropostoDelReso } from '@/components/seller/ReturnRequestCard';
import { interoDelRecesso, rigaResaCents } from '@/lib/rimborsi/regole-del-rimborso';

/**
 * IL RESO DI UN SOLO ARTICOLO, NELLA PAGINA DELL'ORDINE DEL NEGOZIO.
 *
 * Righe da 10 € (maglietta, taglia M) e 20 €, codice sconto da 6 €, 3 € di consegna: il cliente
 * rende la maglietta. Il rimborso che il sistema considera intero (le rotte dei resi) è la riga
 * meno la sua parte dello sconto, 8 €: la scheda del negozio deve proporre quella cifra. E la
 * lettura dell'ordine deve portare la variante, se no «Cosa torna» dice solo «Maglietta».
 */
const ID = '11111111-2222-3333-4444-555555555555';
const MAGLIETTA = '33333333-3333-4333-8333-333333333333';
const RIGHE_NEL_DATABASE = [
  { id: MAGLIETTA, quantity: 1, unit_price: 10, product_name: 'Maglietta', product_image: null, variant_label: 'Taglia M', products: null },
  { id: '44444444-4444-4444-8444-444444444444', quantity: 1, unit_price: 20, product_name: 'Felpa', product_image: null, variant_label: null, products: null },
];
const ORDINE_NEL_DATABASE = {
  id: ID, user_id: 'b1', delivery_status: 'DELIVERED', created_at: '2026-11-18T09:00:00Z', accepted_at: null, ready_at: null,
  picked_up_at: null, delivered_at: '2026-11-18T12:00:00Z', canceled_at: null, pickup_in_store: false, total_price: 27, shipping_cost: 3,
  payment_method: 'card', delivery_fee_cents: 300, discount_amount: 6, wallet_applied_cents: 0, delivery_slot: null,
  delivery_full_name: 'Anna', delivery_phone: null, delivery_address: 'Via Roma 1', delivery_city: 'Piacenza', delivery_zip: '29121',
  delivery_notes: null, rider_id: null, seller: null, order_items: RIGHE_NEL_DATABASE,
};
const RESO = {
  id: 'r1', status: 'REQUESTED', reason: 'DAMAGED', notes: null, photo_urls: [], refund_amount_cents: null,
  decision_notes: null, created_at: '2026-11-20T10:00:00Z', order_item_id: MAGLIETTA, decided_at: null,
};

/** Le colonne chieste dentro `order_items ( … )`, al primo livello. */
function colonneDelleRighe(select: string): string[] {
  const inizio = select.indexOf('order_items');
  const aperta = select.indexOf('(', inizio);
  let livello = 0;
  let pezzo = '';
  const colonne: string[] = [];
  for (const ch of select.slice(aperta + 1)) {
    if (ch === '(') livello++;
    if (ch === ')') { if (livello === 0) break; livello--; }
    if (ch === ',' && livello === 0) { colonne.push(pezzo); pezzo = ''; continue; }
    pezzo += ch;
  }
  colonne.push(pezzo);
  return colonne.map((c) => c.trim().split(/[\s(]/)[0]).filter(Boolean);
}

const stato = vi.hoisted(() => ({
  leggiOrdine: null as null | (() => Promise<unknown>),
  ordine: undefined as unknown,
}));

vi.mock('react', async (orig) => {
  const vero = await orig<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
// Come PostgREST: le righe tornano con le sole colonne chieste.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (tabella: string) => ({
      select: (colonne: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            if (tabella !== 'orders') return { data: null, error: null };
            const chieste = colonneDelleRighe(colonne);
            const righe = RIGHE_NEL_DATABASE.map((r) => Object.fromEntries(chieste.map((c) => [c, (r as Record<string, unknown>)[c]])));
            return { data: { ...ORDINE_NEL_DATABASE, order_items: righe }, error: null };
          },
        }),
      }),
    }),
  },
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: (o: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
    const k = JSON.stringify(o.queryKey);
    if (k === JSON.stringify(queryKeys.seller.order(ID))) {
      stato.leggiOrdine = o.queryFn;
      return { data: stato.ordine, isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: 0, errorUpdatedAt: 0 };
    }
    if (k === JSON.stringify(queryKeys.seller.returnForOrder(ID))) {
      return { data: RESO, isLoading: false, isError: false, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));

const { default: PaginaOrdine } = await import('@/app/seller/orders/[id]/page');
const pagina = () =>
  renderToStaticMarkup(createElement(PaginaOrdine, { params: { valore: { id: ID } } as unknown as Promise<{ id: string }> }));

describe('il reso di un solo articolo nella pagina del negozio', () => {
  it('la cifra giusta è quella delle rotte: 10 € meno la sua parte dei 6 € di sconto = 8 €', () => {
    const riga = rigaResaCents(RIGHE_NEL_DATABASE, MAGLIETTA, 600);
    expect(riga).toBe(800);
    expect(interoDelRecesso(2700, riga)).toBe(800);
    expect(importoPropostoDelReso(27, RIGHE_NEL_DATABASE, MAGLIETTA, 600)).toBe(8);
  });

  it('la lettura vera dell ordine porta la variante: «Cosa torna» dice Maglietta · Taglia M, e propone 8 €', async () => {
    pagina();
    expect(stato.leggiOrdine, 'la pagina non legge l ordine').not.toBeNull();
    stato.ordine = await stato.leggiOrdine!();
    const html = pagina();
    expect(html).toContain('Richiesta di reso');
    expect(html, 'la variante non arriva alla scheda del reso').toMatch(/Cosa torna:.*Maglietta · Taglia M/);
    expect(html).toContain('value="8.00"');
  });
});
