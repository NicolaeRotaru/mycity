/**
 * @vitest-environment jsdom
 *
 * R25-009 — Il campanello del sito contava ancora i gruppi e gli aggiornamenti d'ordine di chi li
 * aveva spenti (`notif_groups`, `notif_order_updates`): la push non parte (`vuole_notifica`), il
 * pallino si accendeva lo stesso. Accesi di serie: spenti solo se la persona li ha spenti davvero.
 * Client Supabase finto: le righe e i filtri si applicano davvero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const UTENTE = 'utente-r25-campanello';
type Notifica = { user_id: string; is_read: boolean; category: string };
let notifiche: Notifica[] = [];
let preferenze: { data: unknown; error: unknown } = { data: null, error: null };

function contaNotifiche() {
  const filtri: Array<(n: Notifica) => boolean> = [];
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: keyof Notifica, v: unknown) => { filtri.push((n) => n[c] === v); return q; },
    // Il filtro di PostgREST che il campanello usa: «category.not.in.(a,b)».
    or: (espressione: string) => {
      const m = /^(\w+)\.not\.in\.\(([^)]*)\)$/.exec(espressione);
      if (!m) throw new Error(`filtro or non previsto dal finto: ${espressione}`);
      const [, c, valori] = m;
      const fuori = valori.split(',');
      filtri.push((n) => !fuori.includes(String(n[c as keyof Notifica])));
      return q;
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ count: notifiche.filter((n) => filtri.every((f) => f(n))).length, error: null }).then(ok, ko),
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: (t: string) => {
      if (t === 'profiles') {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.limit = () => q;
        q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(preferenze.error ? preferenze : { data: preferenze.data ? [preferenze.data] : [], error: null }).then(ok, ko);
        return q;
      }
      return contaNotifiche();
    },
  },
}));
vi.mock('@/components/hooks/useUtente', () => ({
  useUtente: () => ({ userId: UTENTE, caricamento: false }),
  CHIAVE_UTENTE: ['utente'],
}));

import { useNotificationsCount } from '@/components/hooks/useNotificationsCount';

let visto: number | null = null;
function Campanello() {
  visto = useNotificationsCount();
  return createElement('span', null, String(visto));
}

async function conto(): Promise<number | null> {
  visto = null;
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Campanello))); });
  // Si aspetta che la lettura finisca e che il campanello si ridisegni col numero letto.
  await vi.waitFor(() => {
    const letture = qc.getQueryCache().getAll();
    if (letture.length === 0 || letture.some((d) => d.state.status === 'pending')) throw new Error('conto in lettura');
    if (box.textContent !== String(letture[0].state.data ?? 0)) throw new Error('campanello non ancora ridisegnato');
  }, { timeout: 3000 });
  const fuori = visto;
  act(() => root.unmount());
  return fuori;
}

const righe = (category: string, quante: number, is_read = false): Notifica[] =>
  Array.from({ length: quante }, () => ({ user_id: UTENTE, is_read, category }));


describe('R25-009 — il campanello del sito non conta gruppi e ordini spenti', () => {
  beforeEach(() => {
    // 2 ordini, 4 gruppi, 1 di sistema, 3 promozioni non lette; un gruppo gia' letto non conta mai.
    notifiche = [
      ...righe('order', 2), ...righe('group', 4), ...righe('system', 1), ...righe('promo', 3),
      ...righe('group', 1, true),
    ];
  });
  const accese = { notif_promos: true, notif_newsletter: true };

  it('gruppi spenti: i gruppi restano fuori dal conto', async () => {
    preferenze = { data: { ...accese, notif_groups: false, notif_order_updates: true }, error: null };
    expect(await conto()).toBe(6);
  });

  it('aggiornamenti d\'ordine spenti: gli ordini restano fuori dal conto', async () => {
    preferenze = { data: { ...accese, notif_groups: true, notif_order_updates: false }, error: null };
    expect(await conto()).toBe(8);
  });

  it('tutto spento: restano solo gli avvisi di servizio', async () => {
    preferenze = { data: { notif_promos: false, notif_newsletter: false, notif_groups: false, notif_order_updates: false }, error: null };
    expect(await conto()).toBe(1);
  });

  it('tutto acceso, o campi non scritti: si contano gruppi e ordini', async () => {
    preferenze = { data: { ...accese, notif_groups: true, notif_order_updates: true }, error: null };
    expect(await conto()).toBe(10);
    preferenze = { data: { ...accese }, error: null };
    expect(await conto()).toBe(10);
  });

  it('la preferenza non si legge: gruppi e ordini si contano, promo e newsletter no', async () => {
    preferenze = { data: null, error: { code: '57014', message: 'timeout' } };
    expect(await conto()).toBe(7);
  });
});
