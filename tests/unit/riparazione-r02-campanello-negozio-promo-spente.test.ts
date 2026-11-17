/**
 * @vitest-environment jsdom
 */
/**
 * R02-009 — IL CAMPANELLO DEL PANNELLO NEGOZIO CONTAVA ANCHE LE PROMOZIONI DI CHI LE HA SPENTE.
 *
 * Nelle impostazioni c'è «Promozioni» (`profiles.notif_promos`); ogni notifica porta la sua
 * categoria (`category`, migrazione 115: 'promo' per le promozioni). Il campanello del pannello
 * negozio (`useNotifUnread` in SellerShell) contava tutte le non lette, promozioni comprese.
 * Qui si monta il pannello vero, si prende la domanda che fa per il campanello e la si esegue
 * contro un database finto che applica davvero i filtri.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
type Riga = Record<string, unknown>;

/** Un PostgREST in miniatura: eq, neq, maybeSingle e il conteggio esatto, applicati alle righe. */
function databaseFinto(tabelle: Record<string, Riga[]>) {
  return {
    from(tavola: string) {
      const filtri: Array<(r: Riga) => boolean> = [];
      let conta = false;
      const righe = () => (tabelle[tavola] ?? []).filter((r) => filtri.every((f) => f(r)));
      const c: Record<string, unknown> = {
        select: (_colonne: string, opz?: { count?: string; head?: boolean }) => { conta = opz?.count === 'exact'; return c; },
        eq: (col: string, v: unknown) => { filtri.push((r) => r[col] === v); return c; },
        neq: (col: string, v: unknown) => { filtri.push((r) => r[col] !== v); return c; },
        in: (col: string, v: unknown[]) => { filtri.push((r) => v.includes(r[col])); return c; },
        order: () => c,
        limit: () => c,
        maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
        then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(conta ? { data: null, count: righe().length, error: null } : { data: righe(), error: null }).then(ok, ko),
      };
      return c;
    },
  };
}

const NOTIFICHE: Riga[] = [
  { id: 'n1', user_id: 's-1', category: 'promo', title: 'Sconto del 20% sul pane', is_read: false },
  { id: 'n2', user_id: 's-1', category: 'order', title: 'Nuovo ordine da accettare', is_read: false },
  { id: 'n3', user_id: 's-1', category: 'system', title: 'Il cliente ti ha scritto', is_read: false },
  { id: 'n4', user_id: 's-1', category: 'promo', title: 'Promo già letta', is_read: true },
  { id: 'n5', user_id: 'altro', category: 'order', title: 'Di un altro', is_read: false },
];

type Opzioni = { queryKey: unknown[]; queryFn?: () => Promise<unknown> };

/** Il numero che il campanello del pannello negozio chiede, letto davvero. */
async function numeroDelCampanello(notifPromos: boolean | null): Promise<number> {
  globali.__CLIENT_SUPABASE__ = databaseFinto({
    profiles: [{ id: 's-1', notif_promos: notifPromos }],
    notifications: NOTIFICHE.map((n) => ({ ...n })),
    orders: [],
  });
  const mod = await monta('components/seller/SellerShell.tsx');
  const s = accendi(mod.default as never, { children: null });
  await attendi();
  const o = (globali.__OPZIONI_QUERY__ as Opzioni[])
    .filter((q) => q.queryKey[0] === 'notifications' && q.queryKey[1] === 'count')
    .at(-1);
  s.smonta();
  expect(o?.queryFn, 'il pannello negozio non chiede più il conteggio delle notifiche').toBeTypeOf('function');
  return (await o!.queryFn!()) as number;
}

beforeEach(() => {
  globali.__OPZIONI_QUERY__ = [];
  globali.__PERCORSO_FINTO__ = '/seller/dashboard';
  globali.__PROFILO__ = {
    isAuthenticated: true, isSeller: true,
    profile: { id: 's-1', role: 'seller', store_name: 'Forno Bianchi', is_approved: true, approval_status: 'approved' },
  };
});

afterEach(() => {
  for (const k of ['__OPZIONI_QUERY__', '__CLIENT_SUPABASE__', '__PERCORSO_FINTO__', '__PROFILO__']) globali[k] = undefined;
});

describe('R02-009 · il campanello del pannello negozio rispetta «Promozioni» spento', () => {
  it('promozioni spente: la promozione non letta non accende il numero', async () => {
    expect(await numeroDelCampanello(false), 'il campanello conta una promozione a chi le ha spente').toBe(2);
  }, 60000);

  it('preferenza assente: vale spenta, come il valore predefinito della 119', async () => {
    expect(await numeroDelCampanello(null)).toBe(2);
  }, 60000);

  it('promozioni accese: si contano (il verde di controllo)', async () => {
    expect(await numeroDelCampanello(true)).toBe(3);
  }, 60000);
});
