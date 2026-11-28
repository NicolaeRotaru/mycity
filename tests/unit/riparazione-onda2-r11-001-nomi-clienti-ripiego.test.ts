/**
 * R11-001 — Chat e recensioni del negozio, senza la migrazione 181 (funzione
 * `nomi_dei_clienti_del_negozio`), non usavano il ripiego dei nomi: la prima
 * apertura scriveva l'avviso e dava «Cliente», le seguenti davano «Cliente» e
 * basta, anche per chi aveva ordinato. Il ripiego esiste già
 * (`fetchNomiDeiClienti`: il nome di consegna degli ordini che il negozio legge).
 *
 * Adesso senza la funzione si legge il nome dagli ordini, la funzione si chiede
 * una volta sola per apertura e l'avviso resta uno per pagina e per processo.
 * Un guasto vero (non «funzione assente») non legge gli ordini e resta nel
 * registro a ogni apertura.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

type Ordine = { user_id: string; delivery_full_name: string | null };

function clienteFinto(opz: { codice: string | null; ordini?: Ordine[]; nomi?: Array<{ id: string; full_name: string }> }) {
  const conti = { rpc: 0, ordini: 0, vetrina: 0 };
  const supa = {
    rpc: async () => {
      conti.rpc += 1;
      if (opz.codice) return { data: null, error: { code: opz.codice, message: 'errore nomi' } };
      return { data: opz.nomi ?? [], error: null };
    },
    from: (tabella: string) => {
      if (tabella === 'orders') {
        conti.ordini += 1;
        let ids: string[] = [];
        const c = {
          select: () => c,
          in: (_col: string, valori: string[]) => { ids = valori; return c; },
          order: () => c,
          limit: async () => ({ data: (opz.ordini ?? []).filter((o) => ids.includes(o.user_id)), error: null }),
        };
        return c;
      }
      conti.vetrina += 1;
      const v = {
        select: () => v,
        in: async () => ({ data: [{ id: 'negozio-1', store_name: 'Pane Quotidiano' }], error: null }),
      };
      return v;
    },
  };
  return { supa, conti };
}

const ORDINI: Ordine[] = [
  { user_id: 'maria', delivery_full_name: 'Maria Rossi' },
  { user_id: 'estraneo', delivery_full_name: 'Carlo Estraneo' },
];

beforeEach(async () => {
  vi.resetModules();
  const { logger } = await import('@/lib/logger');
  vi.mocked(logger.warn).mockClear();
});

const avvisiDellaPagina = async () => {
  const { logger } = await import('@/lib/logger');
  return vi.mocked(logger.warn).mock.calls.filter((x) => /^\[(chat|recensioni)\] nomi dei clienti/.test(String(x[0]))).length;
};

describe('R11-001 · senza la 181 chat e recensioni leggono il nome di consegna degli ordini', () => {
  it('funzione assente (PGRST202): «Maria Rossi» dagli ordini, chi non ha ordinato resta senza nome, nessun estraneo', async () => {
    const { nomiDeiClienti } = await import('@/lib/queries/controparte-della-chat');
    const { supa, conti } = clienteFinto({ codice: 'PGRST202', ordini: ORDINI });
    const nomi = await nomiDeiClienti(supa, ['maria', 'giulia', 'maria'], '[recensioni]');
    expect(nomi.get('maria'), 'senza la 181 le recensioni non usano il ripiego dei nomi').toBe('Maria Rossi');
    expect(nomi.has('giulia')).toBe(false);
    expect(nomi.has('estraneo')).toBe(false);
    expect(conti.rpc, 'la funzione si chiede una volta sola per apertura').toBe(1);
    expect(conti.ordini).toBe(1);
  });

  it('funzione assente (42883) anche alla seconda apertura: il ripiego vale ancora, l’avviso della pagina resta uno', async () => {
    const { nomiDeiClienti } = await import('@/lib/queries/controparte-della-chat');
    const { supa, conti } = clienteFinto({ codice: '42883', ordini: ORDINI });
    expect((await nomiDeiClienti(supa, ['maria'], '[chat]')).get('maria')).toBe('Maria Rossi');
    expect((await nomiDeiClienti(supa, ['maria'], '[chat]')).get('maria'), 'alla seconda apertura tornava «Cliente»').toBe('Maria Rossi');
    expect(conti.rpc).toBe(2);
    expect(await avvisiDellaPagina(), 'senza la 181 l’avviso si scriveva o si perdeva il ripiego').toBe(1);
  });

  it('in chat il negozio legge il nome del cliente dagli ordini; il cliente legge l’insegna', async () => {
    const { conInsegnaDelNegozio, nomeDellaControparte } = await import('@/lib/queries/controparte-della-chat');
    const { supa } = clienteFinto({ codice: 'PGRST202', ordini: ORDINI });
    const [conv] = await conInsegnaDelNegozio(supa, [{ seller_id: 'negozio-1', buyer_id: 'maria' }], 'negozio-1');
    expect(conv.cliente).toBe('Maria Rossi');
    expect(nomeDellaControparte({ ...conv, buyer: null, seller: null }, 'negozio-1')).toBe('Maria Rossi');
  });

  it('con la 181 gli ordini non si leggono', async () => {
    const { nomiDeiClienti } = await import('@/lib/queries/controparte-della-chat');
    const { supa, conti } = clienteFinto({ codice: null, nomi: [{ id: 'maria', full_name: 'Maria R.' }], ordini: ORDINI });
    expect((await nomiDeiClienti(supa, ['maria'])).get('maria')).toBe('Maria R.');
    expect(conti.ordini).toBe(0);
  });

  it('un guasto vero non legge gli ordini e resta nel registro a ogni apertura', async () => {
    const { nomiDeiClienti } = await import('@/lib/queries/controparte-della-chat');
    const { supa, conti } = clienteFinto({ codice: '57014', ordini: ORDINI });
    expect((await nomiDeiClienti(supa, ['maria'], '[recensioni]')).size).toBe(0);
    expect((await nomiDeiClienti(supa, ['maria'], '[recensioni]')).size).toBe(0);
    expect(conti.ordini).toBe(0);
    expect(await avvisiDellaPagina()).toBe(2);
  });
});
