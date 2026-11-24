import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 24/11/2026 — MODALITÀ DEMO: IL NEGOZIO IN REVISIONE VEDE IL SUO PREVENTIVO E PAGA.
 *
 * Il negozio che ha mandato la richiesta ed è «in attesa» (per esempio Ora del Gusto dopo aver
 * accettato dal link) apre /seller/preventivo e le pagine dei servizi, e dalla pagina d'attesa ha il
 * pulsante per arrivarci. Il resto del pannello resta chiuso; rifiutati e sospesi vedono la loro
 * schermata anche sull'indirizzo del preventivo. Il finto è quello della prova
 * il-negozio-che-non-ha-mandato-la-richiesta-non-legge-stiamo-verificando.
 */

let profilo: Record<string, unknown> | null = null;
let lettura: { data: Record<string, unknown> | null; isLoading: boolean; isError: boolean; status?: string } = { data: null, isLoading: false, isError: false };
let indirizzo = '/seller/preventivo';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => indirizzo }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/seller/SellerShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-prova="cruscotto">{children}</div>,
}));
vi.mock('@/components/seller/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: profilo,
    isAuthenticated: true,
    isLoading: false,
    isSeller: profilo?.role === 'seller',
    isAdmin: profilo?.role === 'admin',
    isBuyer: profilo?.role === 'buyer',
    isRider: profilo?.role === 'rider',
  }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => lettura }));

const { default: SellerLayout } = await import('@/app/seller/layout');
const disegna = () => renderToStaticMarkup(<SellerLayout><p>il-preventivo</p></SellerLayout>);

const IN_ATTESA = { approval_status: 'pending', approval_requested_at: '2026-11-24T10:00:00Z' };

beforeEach(() => {
  profilo = { id: 'u-1', role: 'seller', is_approved: false };
  lettura = { data: IN_ATTESA, isLoading: false, isError: false, status: 'success' };
  indirizzo = '/seller/preventivo';
});

describe('il negozio in attesa di approvazione', () => {
  it('apre il preventivo e le pagine dei servizi', () => {
    expect(disegna()).toContain('il-preventivo');
    indirizzo = '/seller/preventivo/social';
    expect(disegna()).toContain('il-preventivo');
  });

  it('dalla pagina d attesa ha il pulsante per il preventivo', () => {
    indirizzo = '/seller/dashboard';
    const html = disegna();
    expect(html).toContain('Stiamo verificando i dati');
    expect(html).toContain('href="/seller/preventivo"');
    expect(html).toContain('href="/seller/products"');
    expect(html).not.toContain('il-preventivo');
  });

  it('apre anche i suoi prodotti, per prepararli', () => {
    indirizzo = '/seller/products';
    expect(disegna()).toContain('il-preventivo');
    indirizzo = '/seller/products/new';
    expect(disegna()).toContain('il-preventivo');
  });

  it('il resto del pannello resta chiuso', () => {
    indirizzo = '/seller/orders';
    expect(disegna()).not.toContain('il-preventivo');
    indirizzo = '/seller/preventivo-falso';
    expect(disegna()).not.toContain('il-preventivo');
  });

  it('chi non ha ancora mandato la richiesta non lo vede', () => {
    lettura = { data: { approval_status: 'pending', approval_requested_at: null }, isLoading: false, isError: false, status: 'success' };
    expect(disegna()).not.toContain('il-preventivo');
  });

  it('rifiutati e sospesi vedono la loro schermata anche sull indirizzo del preventivo', () => {
    lettura = { data: { approval_status: 'rejected', approval_requested_at: '2026-11-24T10:00:00Z' }, isLoading: false, isError: false, status: 'success' };
    expect(disegna()).not.toContain('il-preventivo');
    lettura = { data: { approval_status: 'suspended', approval_requested_at: '2026-11-24T10:00:00Z' }, isLoading: false, isError: false, status: 'success' };
    expect(disegna()).not.toContain('il-preventivo');
  });
});
