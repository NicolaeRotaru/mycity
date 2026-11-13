/**
 * @vitest-environment jsdom
 */
/**
 * R22-013 (13/11/2026) — LA CAMPANELLA MOSTRAVA LE PROMOZIONI ANCHE A CHI LE AVEVA SPENTE.
 *
 * Nelle impostazioni c'è «Promozioni» (`profiles.notif_promos`). L'interruttore lo leggeva solo
 * l'invio delle push (`vuole_notifica`): la lista di /notifications e il numero sul campanello
 * prendevano tutte le notifiche, promozioni comprese. Un consenso negato che non cambiava niente.
 *
 * Qui si montano la pagina vera e il conteggio vero del campanello, e le loro letture girano
 * contro un database finto che applica davvero i filtri.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
type Riga = Record<string, unknown>;

/** Un PostgREST in miniatura: eq, neq, order, limit e il conteggio esatto, applicati alle righe. */
function databaseFinto(tabelle: Record<string, Riga[]>) {
  return {
    from(tavola: string) {
      const filtri: Array<(r: Riga) => boolean> = [];
      let conta = false;
      let tetto = Infinity;
      let ordine: [string, boolean] | null = null;
      const righe = () => {
        const tutte = (tabelle[tavola] ?? []).filter((r) => filtri.every((f) => f(r)));
        if (ordine) {
          const [col, su] = ordine;
          tutte.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (su ? 1 : -1));
        }
        return tutte.slice(0, tetto);
      };
      const c: Record<string, unknown> = {
        select: (_colonne: string, opz?: { count?: string; head?: boolean }) => { conta = opz?.count === 'exact'; return c; },
        eq: (col: string, v: unknown) => { filtri.push((r) => r[col] === v); return c; },
        neq: (col: string, v: unknown) => { filtri.push((r) => r[col] !== v); return c; },
        order: (col: string, o?: { ascending?: boolean }) => { ordine = [col, o?.ascending ?? true]; return c; },
        limit: (n: number) => { tetto = n; return c; },
        maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
        then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(conta ? { data: null, count: righe().length, error: null } : { data: righe(), error: null }).then(ok, ko),
      };
      return c;
    },
  };
}

const NOTIFICHE: Riga[] = [
  { id: 'n1', user_id: 'u1', category: 'promo', title: 'Sconto del 20% sul pane', body: null, link: '/offerte', is_read: false, created_at: '2026-11-13T09:00:00Z' },
  { id: 'n2', user_id: 'u1', category: 'order', title: 'Il tuo ordine è in consegna', body: null, link: '/orders/1', is_read: false, created_at: '2026-11-13T08:00:00Z' },
  { id: 'n3', user_id: 'u1', category: 'system', title: 'Il negozio ti ha risposto', body: null, link: '/messages/c1', is_read: true, created_at: '2026-11-12T08:00:00Z' },
  { id: 'n4', user_id: 'altro', category: 'order', title: 'Di un altro', body: null, link: null, is_read: false, created_at: '2026-11-13T07:00:00Z' },
];

type Opzioni = { queryKey: unknown[]; queryFn?: () => Promise<unknown> };
const opzioni = (pezzo: string) =>
  (globali.__OPZIONI_QUERY__ as Opzioni[]).filter((o) => o.queryKey[0] === 'notifications' && o.queryKey[1] === pezzo).at(-1);

function conPreferenza(promo: boolean) {
  globali.__CLIENT_SUPABASE__ = databaseFinto({
    profiles: [{ id: 'u1', notif_promos: promo }],
    notifications: NOTIFICHE.map((n) => ({ ...n })),
  });
}

/** La lista che la pagina chiede, letta davvero. */
async function listaDellaPagina() {
  const mod = await monta('app/notifications/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  const o = opzioni('list');
  s.smonta();
  expect(o?.queryFn, 'la pagina non chiede più la lista delle notifiche').toBeTypeOf('function');
  return (await o!.queryFn!()) as Riga[];
}

/** Il numero che il campanello chiede, letto davvero. */
async function numeroDelCampanello() {
  const mod = await monta('components/hooks/useNotificationsCount.ts');
  const usa = mod.useNotificationsCount as () => number;
  const Campanello = () => { usa(); return null; };
  const s = accendi(Campanello);
  await attendi();
  const o = opzioni('count');
  s.smonta();
  expect(o?.queryFn, 'il campanello non chiede più il conteggio').toBeTypeOf('function');
  return (await o!.queryFn!()) as number;
}

beforeEach(() => {
  globali.__UTENTE__ = { id: 'u1' };
  globali.__OPZIONI_QUERY__ = [];
  // L'utente della cache condivisa (useUtente) per il campanello; la pagina lo chiede a getUser.
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (o.queryKey[0] === 'auth' ? { id: 'u1' } : undefined);
});

afterEach(() => {
  globali.__UTENTE__ = undefined;
  globali.__OPZIONI_QUERY__ = undefined;
  globali.__DATI_QUERY__ = undefined;
  globali.__CLIENT_SUPABASE__ = undefined;
});

describe('R22-013 · chi ha spento le promozioni non le trova in campanella', () => {
  it('promozioni spente: la lista non le mostra', async () => {
    conPreferenza(false);
    const lista = await listaDellaPagina();
    expect(lista.map((n) => n.id), 'la lista mostra una promozione a chi le ha spente').toEqual(['n2', 'n3']);
  }, 60000);

  it('promozioni spente: il numero sul campanello non le conta', async () => {
    conPreferenza(false);
    expect(await numeroDelCampanello(), 'il campanello conta una promozione a chi le ha spente').toBe(1);
  }, 60000);

  it('promozioni accese: si vedono e si contano (il verde di controllo)', async () => {
    conPreferenza(true);
    const lista = await listaDellaPagina();
    expect(lista.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(await numeroDelCampanello()).toBe(2);
  }, 60000);
});
