import { describe, it, expect, vi } from 'vitest';

/**
 * R06-011 — Senza la funzione della migrazione 181 il negozio legge il nome dei suoi clienti dal nome
 * di consegna dei loro ordini. La lettura chiedeva gli ordini di TUTTI gli id insieme, i più recenti
 * prima, con un tetto di 1000 righe: un cliente affezionato con mille ordini recenti riempiva il tetto
 * da solo, e chi aveva ordinato una volta, tempo fa, restava «Cliente». Adesso il tetto non nasconde
 * nessuno: chi non è uscito nella prima lettura si cerca ancora.
 */

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { fetchNomiDeiClienti } from '@/lib/queries/seller-public-profiles';

const PANE = 'n-pane';
const ASSIDUA = 'u-assidua';
const UNA_VOLTA = 'u-una-volta';
const DUE_VOLTE = 'u-due-volte';
const SENZA_ORDINI = 'u-solo-chat';

type Ordine = { user_id: string; seller_id: string; delivery_full_name: string | null; created_at: string };

/** Il cliente assiduo: `quanti` ordini a Pane Quotidiano, tutti più recenti degli altri. */
function ordiniDiAssidua(quanti: number): Ordine[] {
  const base = Date.parse('2026-11-01T00:00:00Z');
  return Array.from({ length: quanti }, (_, i) => ({
    user_id: ASSIDUA,
    seller_id: PANE,
    delivery_full_name: 'Anna Assidua',
    created_at: new Date(base + i * 60_000).toISOString(),
  }));
}

/** Un database finto che rispetta `.in`, `.order` e il tetto di `.limit`, come PostgREST. */
function database(ordini: Ordine[]) {
  const letture: number[] = [];
  const from = (tabella: string) => {
    const filtri: Array<(r: Ordine) => boolean> = [];
    let ordine: { colonna: keyof Ordine; asc: boolean } | null = null;
    let tetto = Infinity;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.in = (colonna: keyof Ordine, valori: unknown[]) => { filtri.push((r) => valori.includes(r[colonna])); return q; };
    q.eq = (colonna: keyof Ordine, valore: unknown) => { filtri.push((r) => r[colonna] === valore); return q; };
    q.order = (colonna: keyof Ordine, o?: { ascending?: boolean }) => { ordine = { colonna, asc: o?.ascending !== false }; return q; };
    q.limit = (n: number) => { tetto = n; return q; };
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let righe = tabella === 'orders' ? ordini.filter((o) => o.seller_id === PANE) : [];
      righe = righe.filter((r) => filtri.every((f) => f(r)));
      if (ordine) {
        const { colonna, asc } = ordine;
        righe = [...righe].sort((a, b) => String(a[colonna]).localeCompare(String(b[colonna])) * (asc ? 1 : -1));
      }
      righe = righe.slice(0, tetto);
      letture.push(righe.length);
      return Promise.resolve({ data: righe.map((r) => ({ user_id: r.user_id, delivery_full_name: r.delivery_full_name })), error: null }).then(ok, ko);
    };
    return q;
  };
  const rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.nomi_dei_clienti_del_negozio(p_ids) in the schema cache' } });
  return { client: { from, rpc }, letture };
}

describe('R06-011 · nel ripiego dei nomi dei clienti un cliente con tanti ordini non nasconde gli altri', () => {
  it('mille ordini recenti di un cliente: chi ha ordinato una volta, prima, ha ancora il suo nome', async () => {
    const ordini: Ordine[] = [
      { user_id: UNA_VOLTA, seller_id: PANE, delivery_full_name: 'Ugo Unavolta', created_at: '2026-09-10T10:00:00Z' },
      { user_id: DUE_VOLTE, seller_id: PANE, delivery_full_name: 'Dora Vecchia', created_at: '2026-08-01T10:00:00Z' },
      { user_id: DUE_VOLTE, seller_id: PANE, delivery_full_name: 'Dora Duevolte', created_at: '2026-10-01T10:00:00Z' },
      ...ordiniDiAssidua(1200),
    ];
    const { client } = database(ordini);
    const nomi = await fetchNomiDeiClienti(client, [ASSIDUA, UNA_VOLTA, DUE_VOLTE, SENZA_ORDINI]);
    expect(nomi.get(ASSIDUA)).toBe('Anna Assidua');
    expect(nomi.get(UNA_VOLTA), 'i mille ordini di Anna hanno nascosto Ugo: il negozio legge «Cliente»').toBe('Ugo Unavolta');
    expect(nomi.get(DUE_VOLTE), 'vale il nome dell’ordine più recente').toBe('Dora Duevolte');
    expect(nomi.has(SENZA_ORDINI), 'chi non ha mai ordinato resta «Cliente»').toBe(false);
  });

  it('mille ordini recenti senza nome di un cliente non nascondono chi ha il nome su un ordine più vecchio', async () => {
    const vuoti = ordiniDiAssidua(1000).map((o) => ({ ...o, delivery_full_name: '   ' }));
    const ordini: Ordine[] = [
      { user_id: ASSIDUA, seller_id: PANE, delivery_full_name: 'Anna Primavolta', created_at: '2026-07-01T10:00:00Z' },
      { user_id: UNA_VOLTA, seller_id: PANE, delivery_full_name: 'Ugo Unavolta', created_at: '2026-09-10T10:00:00Z' },
      ...vuoti,
    ];
    const { client } = database(ordini);
    const nomi = await fetchNomiDeiClienti(client, [ASSIDUA, UNA_VOLTA]);
    expect(nomi.get(UNA_VOLTA)).toBe('Ugo Unavolta');
  });

  it('pochi ordini: una lettura sola, come prima', async () => {
    const ordini: Ordine[] = [
      { user_id: UNA_VOLTA, seller_id: PANE, delivery_full_name: 'Ugo Unavolta', created_at: '2026-09-10T10:00:00Z' },
      ...ordiniDiAssidua(5),
    ];
    const { client, letture } = database(ordini);
    const nomi = await fetchNomiDeiClienti(client, [ASSIDUA, UNA_VOLTA, SENZA_ORDINI]);
    expect([...nomi.entries()].sort()).toEqual([[ASSIDUA, 'Anna Assidua'], [UNA_VOLTA, 'Ugo Unavolta']]);
    expect(letture).toHaveLength(1);
  });
});
