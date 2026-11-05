/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { accendi } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/** S08 (5/11/2026) — scheda 2619: la voce «Resi» del menu porta ai resi chiesti. */

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.order = async () => ({
        data: [{ id: 'r-1', order_id: 'o-42', status: 'APPROVED', created_at: '2026-11-02T10:00:00Z' }],
        error: null,
      });
      return q;
    },
  },
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: { href: unknown; children?: unknown } & Record<string, unknown>) => ce('a', { ...r, href: String(href) }, children as never) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import Pagina from '@/app/profile/returns/page';

describe('i miei resi', () => {
  it('la pagina elenca le richieste con il loro stato e il collegamento all ordine', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const s = accendi(() => createElement(QueryClientProvider, { client }, createElement(Pagina)));
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(testoVisibile(s.radice)).toContain('Reso accettato dal negozio');
    expect(Array.from(s.radice.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toContain('/orders/o-42');
    s.smonta();
  });

  it('nel menu dell account (barra e striscia) «Resi» porta ai resi chiesti, non alle regole', () => {
    for (const f of ['components/account/AccountSidebar.tsx', 'components/account/AccountShell.tsx']) {
      const src = readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
      expect(src, f).toContain("{ href: '/profile/returns', icon: RotateCcw, label: 'Resi' }");
    }
  });
});
