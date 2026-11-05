import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * ONDATA 10 — CHI SI ISCRIVE DA «DIVENTA VENDITORE» NASCE GIÀ IN ATTESA.
 *
 * La funzione del database che crea il profilo fa nascere ogni profilo con
 * approval_status='pending'. Chi si iscrive con ?role=seller è quindi un
 * venditore «in attesa» prima di aver mandato qualunque cosa, e /sell gli
 * mostrava «Richiesta in valutazione — abbiamo ricevuto la tua candidatura»
 * invece del modulo. La richiesta vera è quella con approval_requested_at.
 */

let profilo: Record<string, unknown> | null = null;

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isAuthenticated: true, isLoading: false, isSeller: profilo?.role === 'seller' }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: profilo, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({}),
}));
vi.mock('@/components/SellerApplicationForm', () => ({
  default: () => <form data-prova="modulo-venditore" />,
}));

const { default: SellPage } = await import('@/app/sell/page');

beforeEach(() => {
  profilo = null;
});

describe('/sell distingue «mai inviata» da «inviata e in valutazione»', () => {
  it('venditore appena iscritto, richiesta mai inviata: vede il modulo', () => {
    profilo = { role: 'seller', approval_status: 'pending', approval_requested_at: null, email: 'a@b.it' };
    const html = renderToStaticMarkup(<SellPage />);
    expect(html, 'gli diciamo che la candidatura e arrivata quando non l ha mai mandata').not.toContain(
      'Richiesta in valutazione',
    );
    expect(html).toContain('modulo-venditore');
  });

  it('richiesta inviata davvero: vede l attesa, non il modulo', () => {
    profilo = {
      role: 'seller',
      approval_status: 'pending',
      approval_requested_at: '2026-10-20T10:00:00Z',
      email: 'a@b.it',
    };
    const html = renderToStaticMarkup(<SellPage />);
    expect(html).toContain('Richiesta in valutazione');
    expect(html).not.toContain('modulo-venditore');
  });
});

/**
 * 5/11/2026 (S04, scheda 2125) — Il negozio respinto: se /sell gli mostrasse «in valutazione», le
 * prove di prima restavano verdi. Deve vedere il motivo del no e il modulo per riprovare.
 */
describe('/sell al negozio respinto', () => {
  it('vede il no col motivo e il modulo per ripresentarsi, non «Richiesta in valutazione»', () => {
    profilo = {
      role: 'seller',
      approval_status: 'rejected',
      approval_requested_at: '2026-10-20T10:00:00Z',
      rejection_reason: 'documento illeggibile',
      email: 'a@b.it',
    };
    const html = renderToStaticMarkup(<SellPage />);
    expect(html).not.toContain('Richiesta in valutazione');
    expect(html).toContain('Richiesta precedente non approvata');
    expect(html).toContain('documento illeggibile');
    expect(html).toContain('modulo-venditore');
  });
});
