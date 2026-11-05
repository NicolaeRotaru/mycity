import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { queryKeys } from '@/lib/queries/keys';

/**
 * S06 — La pagina dell'ordine nel pannello del negozio.
 * 2084: se cade la lettura del codice di ritiro o del reso, compare «Riprova».
 * 474:  su un ritiro in negozio non si mostra il codice «da dare al rider».
 * 171:  un ordine già accettato si può ancora annullare (rotta del rifiuto).
 * 2526: il velo del riquadro di rifiuto non ha un clic su un div visibile.
 */

const ID = '11111111-2222-3333-4444-555555555555';
const stato = vi.hoisted(() => ({
  ordine: {} as Record<string, unknown>,
  ordineInErrore: false,
  codice: { data: undefined, isError: false } as Record<string, unknown>,
  reso: { data: undefined, isError: false } as Record<string, unknown>,
}));

vi.mock('react', async (orig) => {
  const vero = await orig<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: (o: { queryKey: unknown[] }) => {
    const k = JSON.stringify(o.queryKey);
    if (k === JSON.stringify(queryKeys.seller.order(ID))) {
      return { data: stato.ordine, isLoading: false, isError: stato.ordineInErrore, refetch: vi.fn(), dataUpdatedAt: 0, errorUpdatedAt: 0 };
    }
    if (k === JSON.stringify(queryKeys.seller.pickupCode(ID))) return { refetch: vi.fn(), ...stato.codice };
    if (k === JSON.stringify(queryKeys.seller.returnForOrder(ID))) return { refetch: vi.fn(), ...stato.reso };
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));

const { default: Pagina } = await import('@/app/seller/orders/[id]/page');
const disegna = () =>
  renderToStaticMarkup(<Pagina params={{ valore: { id: ID } } as unknown as Promise<{ id: string }>} />);

const ordine = (p: Record<string, unknown> = {}) => ({
  id: ID, user_id: 'b1', delivery_status: 'ACCEPTED', created_at: '2026-11-05T09:00:00Z',
  pickup_in_store: false, total_price: 12, shipping_cost: 3, payment_method: 'cod',
  delivery_slot: null, order_items: [], rider: null, seller: null, ...p,
});

beforeEach(() => {
  stato.ordine = ordine();
  stato.ordineInErrore = false;
  stato.codice = { data: undefined, isError: false };
  stato.reso = { data: undefined, isError: false };
});

describe('2084 — letture cadute', () => {
  it('codice di ritiro non letto: lo dice e offre «Riprova»', () => {
    stato.codice = { data: undefined, isError: true };
    const html = disegna();
    expect(html).toContain('Non riesco a leggere il codice di ritiro');
    expect(html).toContain('Riprova');
  });
  it('reso non letto: lo dice e offre «Riprova»', () => {
    stato.reso = { data: undefined, isError: true };
    expect(disegna()).toContain('Non riesco a leggere se c&#x27;è una richiesta di reso');
  });
});

describe('474 — ritiro in negozio', () => {
  it('non mostra il codice «da mostrare al rider»', () => {
    stato.ordine = ordine({ pickup_in_store: true, delivery_status: 'READY' });
    stato.codice = { data: { code: '482913', verified_at: null }, isError: false };
    const html = disegna();
    expect(html).not.toContain('482913');
    expect(html).not.toContain('al rider quando viene a ritirare');
  });
  it('sulla consegna il codice per il rider c\'è', () => {
    stato.codice = { data: { code: '482913', verified_at: null }, isError: false };
    expect(disegna()).toContain('482913');
  });
});

describe('171 — annullare un ordine già accettato', () => {
  it('in ACCEPTED c\'è «Non posso completarlo, annulla»', () => {
    expect(disegna()).toContain('Non posso completarlo, annulla');
  });
});

describe('2526 — il velo del riquadro di rifiuto', () => {
  it('il clic sta su un velo nascosto al lettore di schermo, non sul riquadro', () => {
    const src = readFileSync('app/seller/orders/[id]/page.tsx', 'utf8');
    expect(src).toContain('<div aria-hidden="true" className="absolute inset-0" onClick={onCancel} />');
    expect(src).not.toContain('onClick={(e) => e.stopPropagation()}');
    expect(src).not.toContain('if (e.target === e.currentTarget) onCancel();');
  });
});

describe('2376 — la rilettura dell\'ordine cade', () => {
  it('l\'ordine già letto resta a schermo con un avviso', () => {
    stato.ordineInErrore = true;
    const html = disegna();
    expect(html).toContain('Non riesco ad aggiornare l&#x27;ordine');
    expect(html).toContain('Pronto per il rider');
  });
});
