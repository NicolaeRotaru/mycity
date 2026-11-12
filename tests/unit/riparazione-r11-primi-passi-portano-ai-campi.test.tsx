// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-014 — La lista dei primi passi mandava al profilo per mettere nome e logo,
 * ma nel profilo quei campi non ci sono: stanno in «Costruisci il sito» →
 * Dettagli negozio (StoreDetailsEditor).
 */

function catena(dati: unknown, count?: number): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: dati, error: null, count }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'forno' } } }),
      getSession: async () => ({ data: { session: { user: { id: 'forno' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: (t: string) =>
      t === 'products'
        ? catena(null, 0)
        : catena({ store_name: null, store_logo: null, store_address: null, store_lat: null, store_lng: null, store_hours: null, stripe_account_id: null }),
  },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));

vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ profile: { id: 'forno' } }) }));

import SellerOnboardingChecklist from '@/components/seller/SellerOnboardingChecklist';

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

describe('R11-014 — nome e logo portano dove i campi ci sono', () => {
  it('«Imposta nome» e «Carica logo» aprono i Dettagli negozio, non il profilo', async () => {
    const r = await disegna(createElement(SellerOnboardingChecklist));
    chiudi = r.chiudi;
    const link = (testo: string) =>
      Array.from(r.host.querySelectorAll('a')).find((a) => a.textContent?.includes(testo))?.getAttribute('href');
    expect(link('Imposta nome'), 'il profilo non ha i campi nome e logo').toBe('/seller/site?details=1');
    expect(link('Carica logo')).toBe('/seller/site?details=1');
  });

  it('e lì i campi ci sono davvero', () => {
    const editor = readFileSync(join(process.cwd(), 'components/seller/site/StoreDetailsEditor.tsx'), 'utf8');
    expect(editor).toContain('store_name');
    expect(editor).toContain('store_logo');
  });
});
