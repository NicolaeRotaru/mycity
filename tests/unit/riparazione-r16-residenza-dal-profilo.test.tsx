import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R16-010 — Indirizzo, CAP e città del profilo non si correggono più.
 *
 * Dal 5/11 il Profilo non mostra più indirizzo, CAP e città (la cassa non li usa: gli indirizzi
 * di consegna stanno nella rubrica). Ma /sell li leggeva ancora per precompilare la residenza del
 * negoziante: arrivava un indirizzo vecchio che nessuno poteva più rettificare dal Profilo.
 * Qui si monta /sell e si guarda con che cosa viene precompilato il modulo.
 */

let profilo: Record<string, unknown> | null = null;
let valoriDelModulo: Record<string, unknown> | null = null;

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isAuthenticated: true, isLoading: false, isSeller: false }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: profilo, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({}),
}));
vi.mock('@/components/SellerApplicationForm', () => ({
  default: (p: { defaultValues: Record<string, unknown> }) => {
    valoriDelModulo = p.defaultValues;
    return <form data-prova="modulo-venditore" />;
  },
}));

const { default: SellPage } = await import('@/app/sell/page');

beforeEach(() => {
  profilo = null;
  valoriDelModulo = null;
});

describe('R16-010 · /sell non precompila la residenza con l’indirizzo del profilo che non si può correggere', () => {
  it('un cliente con un vecchio indirizzo nel profilo trova la residenza vuota, da scrivere lui', () => {
    profilo = {
      role: 'buyer', approval_status: 'pending', approval_requested_at: null, email: 'a@b.it',
      full_name: 'Anna Rossi', address: 'Via Vecchia 1', city: 'Milano', zip: '20100',
    };
    const html = renderToStaticMarkup(<SellPage />);
    expect(html).toContain('modulo-venditore');
    expect(valoriDelModulo).toMatchObject({ legalResidenceAddr: '', legalResidenceCity: '', legalResidenceZip: '' });
  });

  it('la residenza già scritta nel modulo resta precompilata', () => {
    profilo = {
      role: 'seller', approval_status: 'rejected', approval_requested_at: '2026-10-20T10:00:00Z', email: 'a@b.it',
      address: 'Via Vecchia 1', city: 'Milano', zip: '20100',
      legal_residence_addr: 'Via Roma 12', legal_residence_city: 'Piacenza', legal_residence_zip: '29121',
    };
    renderToStaticMarkup(<SellPage />);
    expect(valoriDelModulo).toMatchObject({
      legalResidenceAddr: 'Via Roma 12', legalResidenceCity: 'Piacenza', legalResidenceZip: '29121',
    });
  });
});
