/**
 * @vitest-environment jsdom
 */
/**
 * R07-010 — Il campanello del pannello negozio contava tutte le notifiche non lette, anche le
 * promozioni di chi le aveva spente nelle impostazioni (`profiles.notif_promos`): la push non
 * arrivava (la regola sta in `vuole_notifica`, migrazione 115), ma il pallino si accendeva lo stesso.
 *
 * Qui si monta il pannello VERO, si prende la lettura del campanello che il pannello consegna a
 * react-query e la si fa girare su un database finto che applica davvero i filtri alle righe.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

type Riga = Record<string, unknown>;
type Opzioni = { queryKey: unknown[]; queryFn?: () => Promise<unknown> };

const mondo = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  letture: [] as Array<{ queryKey: unknown[]; queryFn?: () => Promise<unknown> }>,
}));

/** Un pezzetto di PostgREST: select, eq, neq, in, maybeSingle e il conteggio «head». */
function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let soloConto = false;
  const righe = () => (mondo.tabelle[nome] ?? []).filter((r) => filtri.every((f) => f(r)));
  const q = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { soloConto = !!o?.head; return q; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
    neq: (c: string, v: unknown) => { filtri.push((r) => r[c] !== v); return q; },
    in: (c: string, v: unknown[]) => { filtri.push((r) => v.includes(r[c])); return q; },
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(soloConto ? { count: righe().length, error: null } : { data: righe(), error: null }).then(ok, ko),
  };
  return q;
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: Opzioni) => { mondo.letture.push(o); return { data: 0 }; },
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { signOut: async () => ({}) }, from: (t: string) => tabella(t) },
}));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Forno' }, userEmail: 'f@f.it', isAuthenticated: true, isSeller: true }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

import SellerShell from '@/components/seller/SellerShell';

let smonta: (() => void) | null = null;
afterEach(() => {
  smonta?.();
  smonta = null;
  mondo.letture = [];
  mondo.tabelle = {};
});

const NOTIFICHE: Riga[] = [
  { id: 'n1', user_id: 's-1', is_read: false, category: 'order' },
  { id: 'n2', user_id: 's-1', is_read: false, category: 'promo' },
  { id: 'n3', user_id: 's-1', is_read: false, category: 'system' },
  { id: 'n4', user_id: 's-1', is_read: true, category: 'promo' },
  { id: 'n5', user_id: 's-1', is_read: true, category: 'order' },
  { id: 'n6', user_id: 'altro', is_read: false, category: 'order' },
];

/** Il numero sul campanello del negozio, con la preferenza promozioni data. */
async function numeroDelCampanello(notifPromos: boolean): Promise<unknown> {
  mondo.tabelle = {
    profiles: [{ id: 's-1', notif_promos: notifPromos }, { id: 'altro', notif_promos: true }],
    notifications: NOTIFICHE,
  };
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  await act(async () => { root.render(createElement(SellerShell, null, createElement('p', null, 'contenuto'))); });
  smonta = () => { act(() => root.unmount()); radice.remove(); };
  const campanello = mondo.letture.find((o) => o.queryKey.includes('seller-bell'));
  expect(campanello?.queryFn, 'il pannello non legge più il numero del campanello').toBeTypeOf('function');
  return campanello!.queryFn!();
}

describe('R07-010 · il campanello del negozio non conta le promozioni di chi le ha spente', () => {
  it('promozioni spente: conta l ordine e l avviso di servizio non letti, non la promozione', async () => {
    expect(await numeroDelCampanello(false)).toBe(2);
  });

  it('promozioni accese: la promozione non letta si conta', async () => {
    expect(await numeroDelCampanello(true)).toBe(3);
  });
});
