/**
 * @vitest-environment jsdom
 */
/**
 * 1/11/2026 — DAL PANNELLO NEGOZIO NON SI ARRIVAVA AI MESSAGGI DEI CLIENTI.
 *
 * Il pannello /seller nasconde la testata del sito (Navbar e barra in basso), quindi
 * l'icona dei messaggi spariva proprio al negoziante. Nella barra laterale non c'era
 * una voce «Messaggi»: i clienti scrivevano e il negozio non aveva una strada per
 * leggerli. Qui si monta il pannello e si cerca il link a /messages.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 0 }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: async () => ({}) }, from: () => ({}) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Forno' }, userEmail: 'f@f.it', isAuthenticated: true, isSeller: true }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import SellerShell from '@/components/seller/SellerShell';

describe('il pannello negozio porta ai messaggi dei clienti', () => {
  it('nella barra laterale c è la voce Messaggi verso /messages', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => { root.render(createElement(SellerShell, null, createElement('p', null, 'contenuto'))); });
    const link = radice.querySelector('a[href="/messages"]');
    expect(link, 'il pannello negozio non ha un link ai messaggi').not.toBeNull();
    expect(link!.textContent).toContain('Messaggi');
    act(() => root.unmount());
  });
});
