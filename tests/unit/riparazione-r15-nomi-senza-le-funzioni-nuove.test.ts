import { describe, it, expect, vi } from 'vitest';

/**
 * R15-014 — Il negozio legge «Cliente» al posto dei nomi perché nel database vero la funzione della
 * migrazione 181 (`nomi_dei_clienti_del_negozio`) non c'è: PostgREST risponde «funzione non trovata».
 *
 * Il ripiego: solo quando la funzione manca, il nome di consegna degli ordini che chi guarda legge già
 * (le sue regole: il negozio vede solo gli ordini fatti a lui). Mai `profiles`, mai nomi di persone che
 * il negozio non ha davanti.
 */

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { fetchNomiDeiClienti } from '@/lib/queries/seller-public-profiles';

const PANE = 'n-pane';
const SALUMI = 'n-salumi';
const MARIA = 'u-maria';
const GIULIA = 'u-giulia';
const ESTRANEO = 'u-estraneo';
const SOLO_CHAT = 'u-solo-chat';

const ORDINI = [
  { id: 'o1', user_id: MARIA, seller_id: PANE, delivery_full_name: 'Maria Rossi', created_at: '2026-10-20T10:00:00Z' },
  { id: 'o2', user_id: MARIA, seller_id: PANE, delivery_full_name: 'Maria R.', created_at: '2026-10-25T10:00:00Z' },
  { id: 'o3', user_id: GIULIA, seller_id: PANE, delivery_full_name: '  Giulia Bianchi ', created_at: '2026-10-21T10:00:00Z' },
  { id: 'o4', user_id: ESTRANEO, seller_id: SALUMI, delivery_full_name: 'Carlo Estraneo', created_at: '2026-10-22T10:00:00Z' },
];
const PROFILI = [
  { id: MARIA, full_name: 'Maria Rossi', billing_iban: 'IT60X0542811101000000123456' },
  { id: GIULIA, full_name: 'Giulia Bianchi' },
  { id: ESTRANEO, full_name: 'Carlo Estraneo' },
  { id: SOLO_CHAT, full_name: 'Sara Chat' },
];

const FUNZIONE_MANCANTE = {
  code: 'PGRST202',
  message: 'Could not find the function public.nomi_dei_clienti_del_negozio(p_ids) in the schema cache',
};

/**
 * Un database finto con le regole di produzione: `orders` si legge solo per gli ordini propri (come
 * cliente o come negozio), `profiles` solo per la propria riga. La funzione della 181 c'è o no.
 */
function database(chi: string, funzione: 'manca' | 'manca-42883' | 'c-e' | 'guasto') {
  const lette: string[] = [];
  const chiamate: string[] = [];
  const from = (tabella: string) => {
    lette.push(tabella);
    const filtri: Array<(r: Record<string, unknown>) => boolean> = [];
    let ordine: { colonna: string; asc: boolean } | null = null;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.in = (colonna: string, valori: unknown[]) => { filtri.push((r) => valori.includes(r[colonna])); return q; };
    q.eq = (colonna: string, valore: unknown) => { filtri.push((r) => r[colonna] === valore); return q; };
    q.order = (colonna: string, o?: { ascending?: boolean }) => { ordine = { colonna, asc: o?.ascending !== false }; return q; };
    q.limit = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let righe: Array<Record<string, unknown>> =
        tabella === 'orders'
          ? ORDINI.filter((o) => o.user_id === chi || o.seller_id === chi)
          : tabella === 'profiles'
            ? PROFILI.filter((p) => p.id === chi)
            : [];
      righe = righe.filter((r) => filtri.every((f) => f(r)));
      if (ordine) {
        const { colonna, asc } = ordine;
        righe = [...righe].sort((a, b) => String(a[colonna]).localeCompare(String(b[colonna])) * (asc ? 1 : -1));
      }
      return Promise.resolve({ data: righe, error: null }).then(ok, ko);
    };
    return q;
  };
  const rpc = async (nome: string, argomenti: Record<string, unknown>) => {
    chiamate.push(nome);
    if (funzione === 'manca') return { data: null, error: FUNZIONE_MANCANTE };
    if (funzione === 'manca-42883') return { data: null, error: { code: '42883', message: `function ${nome}(uuid[]) does not exist` } };
    if (funzione === 'guasto') return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const ids = (argomenti.p_ids as string[]) ?? [];
    const davanti = (id: string) => ORDINI.some((o) => o.seller_id === chi && o.user_id === id);
    return { data: PROFILI.filter((p) => ids.includes(p.id) && davanti(p.id)).map((p) => ({ id: p.id, full_name: p.full_name })), error: null };
  };
  return { client: { from, rpc }, lette, chiamate };
}

describe('R15-014 · i nomi dei clienti senza la funzione della 181', () => {
  it('funzione mancante: il negozio legge il nome di consegna dei suoi ordini, non «Cliente»', async () => {
    const { client, chiamate } = database(PANE, 'manca');
    const nomi = await fetchNomiDeiClienti(client, [MARIA, GIULIA, MARIA]);
    expect(chiamate).toEqual(['nomi_dei_clienti_del_negozio']);
    expect(nomi.get(MARIA), 'Maria ha ordinato da Pane Quotidiano: il negozio legge il suo nome').toBe('Maria R.');
    expect(nomi.get(GIULIA)).toBe('Giulia Bianchi');
  });

  it('anche col codice di Postgres (42883) vale il ripiego', async () => {
    const { client } = database(PANE, 'manca-42883');
    const nomi = await fetchNomiDeiClienti(client, [GIULIA]);
    expect(nomi.get(GIULIA)).toBe('Giulia Bianchi');
  });

  it('il ripiego non legge profiles e non dà nomi di chi non ha ordinato da questo negozio', async () => {
    const { client, lette } = database(PANE, 'manca');
    const nomi = await fetchNomiDeiClienti(client, [MARIA, ESTRANEO, SOLO_CHAT]);
    expect(lette).not.toContain('profiles');
    expect(lette).toEqual(['orders']);
    expect(nomi.has(ESTRANEO), 'Carlo ha ordinato da un altro negozio').toBe(false);
    expect(nomi.has(SOLO_CHAT), 'chi ha solo scritto in chat resta «Cliente»').toBe(false);
    expect([...nomi.keys()]).toEqual([MARIA]);
  });

  it('con la funzione della 181 il nome arriva da lei, e gli ordini non si leggono', async () => {
    const { client, lette } = database(PANE, 'c-e');
    const nomi = await fetchNomiDeiClienti(client, [MARIA, ESTRANEO]);
    expect(nomi.get(MARIA)).toBe('Maria Rossi');
    expect(nomi.has(ESTRANEO)).toBe(false);
    expect(lette).toEqual([]);
  });

  it('un guasto della funzione (non «mancante») non diventa un ripiego: nessun nome, nessuna lettura', async () => {
    const { client, lette } = database(PANE, 'guasto');
    const nomi = await fetchNomiDeiClienti(client, [MARIA]);
    expect(nomi.size).toBe(0);
    expect(lette).toEqual([]);
  });

  it('nessun id, nessuna domanda', async () => {
    const { client, lette, chiamate } = database(PANE, 'manca');
    expect((await fetchNomiDeiClienti(client, [null, undefined])).size).toBe(0);
    expect(lette).toEqual([]);
    expect(chiamate).toEqual([]);
  });
});
