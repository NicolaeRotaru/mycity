// @vitest-environment jsdom
/**
 * R10-007 — Il campanello del negozio contava ancora le newsletter spente (`notif_newsletter`):
 * toglieva solo le promozioni. Qui il pannello VERO, con un database finto che applica davvero i
 * filtri `neq('category', …)`: la sola notifica non letta è una newsletter e la persona l'ha spenta,
 * quindi il pallino del campanello non deve accendersi.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Prefs = { notif_promos: boolean; notif_newsletter: boolean };
const stato: { prefs: Prefs; righe: { category: string }[] } = { prefs: { notif_promos: true, notif_newsletter: true }, righe: [] };

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { signOut: async () => ({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    from(tabella: string) {
      const esclusi: string[] = [];
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q;
      q.neq = (_c: string, v: string) => { esclusi.push(v); return q; };
      q.maybeSingle = async () => ({ data: stato.prefs, error: null });
      q.then = (ok: (r: unknown) => unknown) =>
        ok(tabella === 'notifications'
          ? { count: stato.righe.filter((r) => !esclusi.includes(r.category)).length, data: [], error: null }
          : { count: 0, data: [], error: null });
      return q;
    },
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Forno' }, userEmail: 'f@f.it', isAuthenticated: true, isSeller: true }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: SellerShell } = await import('@/components/seller/SellerShell');

async function pallino(prefs: Prefs, righe: string[]) {
  stato.prefs = prefs;
  stato.righe = righe.map((category) => ({ category }));
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerShell, null, createElement('p', null, 'x')))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  const acceso = !!div.querySelector('button[aria-label="Notifiche"] span.bg-secondary-600');
  root.unmount();
  return acceso;
}

describe('R10-007 — il pallino del campanello del negozio e le categorie spente', () => {
  it('newsletter spenta, promozioni accese: una sola newsletter non accende il pallino', async () => {
    expect(await pallino({ notif_promos: true, notif_newsletter: false }, ['newsletter'])).toBe(false);
  });
  it('promozioni e newsletter spente: restano gli ordini a contare', async () => {
    expect(await pallino({ notif_promos: false, notif_newsletter: false }, ['newsletter', 'promo', 'order'])).toBe(true);
  });
  it('newsletter accesa: la newsletter accende il pallino', async () => {
    expect(await pallino({ notif_promos: true, notif_newsletter: true }, ['newsletter'])).toBe(true);
  });
});
