import { describe, it, expect, vi } from 'vitest';

/**
 * 16/10/2026 (riesame del lotto) — UNA LETTURA CHE TOGLIEVA DUE MIGRAZIONI INSIEME.
 *
 * La lettura degli ordini di una contestazione chiede colonne della 124 e della
 * 126. In produzione la 124 c'è e la 126 no. Il ripiego, al primo «colonna che
 * non esiste», rileggeva togliendo le colonne di tutte e due: si perdeva il
 * numero di tentativo del bonifico (della 124, che c'è), e la contestazione
 * vinta rimetteva in coda il bonifico sempre col tentativo 1.
 *
 * Qui il database finto è come la produzione: la 124 c'è, la 126 no.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { leggiAGradini, selectAGradini } from '@/lib/db/ripiego-a-gradini';
import { COLONNE_124 } from '@/lib/db/migrazione-124';
import { COLONNE_126_CONTESTAZIONE } from '@/lib/stripe/webhook/comune';

const RIGA: Record<string, unknown> = { id: 'o1', payout_status: 'REVERSED', payout_tentativo: 2, rider_payout_tentativo: 1 };

/** Un database che ha la 124 ma non la 126: una colonna della 126 chiesta risponde 42703. */
function databaseSenza126() {
  const chieste: string[] = [];
  const esegui = async (select: string) => {
    chieste.push(select);
    const colonne = select.split(',').map((c) => c.trim());
    const manca = colonne.find((c) => (COLONNE_126_CONTESTAZIONE as readonly string[]).includes(c));
    if (manca) return { data: null, error: { code: '42703', message: `column orders.${manca} does not exist` } };
    return { data: [Object.fromEntries(colonne.filter((c) => c in RIGA).map((c) => [c, RIGA[c]]))], error: null };
  };
  return { chieste, esegui };
}

const SELECT = 'id, payout_status, dispute_seller_reversed_cents, payout_tentativo, dispute_rider_reversed_cents, rider_payout_tentativo';
const GRUPPI = [COLONNE_126_CONTESTAZIONE, COLONNE_124];

describe('la lettura scende una migrazione alla volta', () => {
  it('senza la 126 il tentativo del bonifico si legge ancora (era undefined)', async () => {
    const db = databaseSenza126();
    const { data, error } = await leggiAGradini('prova', SELECT, GRUPPI, db.esegui);
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ payout_tentativo: 2, rider_payout_tentativo: 1 });
    expect(db.chieste, 'due letture: intera, poi senza la sola 126').toHaveLength(2);
  });

  it('i gradini: intera, senza la 126, senza anche la 124', () => {
    expect(selectAGradini(SELECT, GRUPPI)).toEqual([
      SELECT,
      'id, payout_status, payout_tentativo, rider_payout_tentativo',
      'id, payout_status',
    ]);
  });

  it('un gruppo che la select non chiede non fa un gradino a vuoto', () => {
    expect(selectAGradini('id, payout_tentativo', GRUPPI)).toEqual(['id, payout_tentativo', 'id']);
  });

  it('un errore che non è «colonna che non c è» non fa scendere: torna così com è', async () => {
    let letture = 0;
    const esito = await leggiAGradini('prova', SELECT, GRUPPI, async () => {
      letture += 1;
      return { data: null, error: { code: '57014', message: 'timeout' } };
    });
    expect(letture).toBe(1);
    expect(esito.error).toMatchObject({ code: '57014' });
  });

  it('senza nemmeno la 124 scende fino in fondo', async () => {
    const chieste: string[] = [];
    const esito = await leggiAGradini('prova', SELECT, GRUPPI, async (select) => {
      chieste.push(select);
      const manca = select.split(',').map((c) => c.trim())
        .find((c) => [...COLONNE_126_CONTESTAZIONE, ...COLONNE_124].includes(c as never));
      return manca
        ? { data: null, error: { code: '42703', message: `column orders.${manca} does not exist` } }
        : { data: [{ id: 'o1' }], error: null };
    });
    expect(esito.error).toBeNull();
    expect(chieste).toHaveLength(3);
  });
});
