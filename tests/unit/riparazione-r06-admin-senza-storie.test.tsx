// @vitest-environment jsdom
/**
 * R06-012 (26/11/2026) — Un admin nell'area negozio non arriva alla pagina delle storie:
 * la foto si caricava e l'inserimento era rifiutato, lasciando la foto orfana.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const stato = { pathname: '/seller/stories' };

vi.mock('next/navigation', () => ({ usePathname: () => stato.pathname, useRouter: () => ({ replace: () => undefined }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: null, status: 'idle', isLoading: false, isFetching: false }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'a1', role: 'admin', is_approved: true },
    isAuthenticated: true, isLoading: false, isSeller: false, isAdmin: true, isBuyer: false, isRider: false,
    isError: false, refetch: () => undefined,
  }),
}));
vi.mock('@/components/seller/SellerShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <div id="guscio">{children}</div> }));
vi.mock('@/components/seller/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }));

describe('R06-012 · admin e storie', () => {
  it('l\'admin sulla pagina delle storie non vede il modulo ma una spiegazione', async () => {
    stato.pathname = '/seller/stories';
    const { default: Layout } = await import('@/app/seller/layout');
    const html = renderToStaticMarkup(<Layout><p id="modulo-storie">modulo</p></Layout>);
    expect(html).not.toContain('modulo-storie');
    expect(html).toContain('Le storie sono dei negozi');
  });

  it('l\'admin nelle altre pagine dell\'area negozio entra come prima', async () => {
    stato.pathname = '/seller/products';
    const { default: Layout } = await import('@/app/seller/layout');
    const html = renderToStaticMarkup(<Layout><p id="altra-pagina">ok</p></Layout>);
    expect(html).toContain('altra-pagina');
  });
});
