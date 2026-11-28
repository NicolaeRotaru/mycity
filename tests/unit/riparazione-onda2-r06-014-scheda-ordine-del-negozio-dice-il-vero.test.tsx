import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Onda 2 · R06-014 — Nella scheda ordine del negozio comparivano «il fattorino sta gestendo la
 * consegna» su un ordine annullato e «il fattorino incassa» su uno già consegnato.
 *
 * Il riquadro del fattorino guardava solo «c'è un fattorino e non è consegnato»: un ordine annullato
 * dopo la presa in carico tiene il fattorino scritto sulla riga, e la scheda diceva ancora che stava
 * consegnando. Quello dei contanti guardava solo «non annullato»: a consegna fatta diceva ancora
 * «incassa», al futuro, e sul ritiro in negozio diceva che incassava il fattorino, che non c'è.
 */

const ID = '11111111-2222-3333-4444-555555555555';
const stato = vi.hoisted(() => ({ ordine: {} as Record<string, unknown> }));

vi.mock('react', async (orig) => {
  const vero = await orig<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: (o: { queryKey: unknown[] }) => {
    if (JSON.stringify(o.queryKey) === JSON.stringify(queryKeys.seller.order(ID))) {
      return { data: stato.ordine, isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: 0, errorUpdatedAt: 0 };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));

const { default: Pagina } = await import('@/app/seller/orders/[id]/page');
const disegna = () =>
  renderToStaticMarkup(<Pagina params={{ valore: { id: ID } } as unknown as Promise<{ id: string }>} />);

const ordine = (p: Record<string, unknown> = {}) => ({
  id: ID, user_id: 'b1', delivery_status: 'OUT_FOR_DELIVERY', created_at: '2026-11-05T09:00:00Z',
  pickup_in_store: false, total_price: 12, shipping_cost: 3, payment_method: 'cod', rider_id: 'r1',
  delivery_slot: null, order_items: [], rider: { full_name: 'Gino' }, seller: null, ...p,
});

beforeEach(() => {
  stato.ordine = ordine();
});

describe('R06-014 · il riquadro del fattorino', () => {
  it('in strada dice che il fattorino sta gestendo la consegna', () => {
    expect(disegna()).toContain('sta gestendo la consegna');
  });
  it('su un ordine annullato dopo la presa in carico non lo dice più', () => {
    stato.ordine = ordine({ delivery_status: 'CANCELED' });
    expect(disegna()).not.toContain('sta gestendo la consegna');
  });
});

describe('R06-014 · il riquadro dei contanti', () => {
  it('in strada: «il fattorino incassa»', () => {
    expect(disegna()).toContain('Il fattorino incassa');
  });
  it('a consegna fatta non dice più «incassa» al futuro', () => {
    stato.ordine = ordine({ delivery_status: 'DELIVERED' });
    const html = disegna();
    expect(html).not.toContain('Il fattorino incassa');
    expect(html).toContain('Il fattorino ha incassato');
  });
  it('sul ritiro in negozio non parla del fattorino che incassa', () => {
    stato.ordine = ordine({ pickup_in_store: true, delivery_status: 'READY', rider_id: null, rider: null });
    expect(disegna()).not.toMatch(/Il fattorino (incassa|ha incassato)/);
  });
  it('su un ordine annullato niente contanti', () => {
    stato.ordine = ordine({ delivery_status: 'CANCELED' });
    expect(disegna()).not.toMatch(/Il fattorino (incassa|ha incassato)/);
  });
});
