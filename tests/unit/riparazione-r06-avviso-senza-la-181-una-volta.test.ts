import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R06-004 — Finché nel database vero manca la funzione della migrazione 181, il ripiego dei nomi dei
 * clienti scriveva l'avviso «funzione assente» a OGNI chiamata: ogni apertura della chat o delle
 * recensioni del negozio, una riga nel registro, sempre la stessa. Adesso l'avviso si scrive una volta;
 * il ripiego continua a lavorare a ogni chiamata, e un guasto vero resta nel registro ogni volta.
 */

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { logger } from '@/lib/logger';
import { fetchNomiDeiClienti } from '@/lib/queries/seller-public-profiles';

const MARIA = 'u-maria';
const PANE = 'n-pane';

function database(funzione: 'manca' | 'guasto', ordiniLetti: { quante: number }) {
  const from = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.in = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      ordiniLetti.quante++;
      return Promise.resolve({ data: [{ user_id: MARIA, seller_id: PANE, delivery_full_name: 'Maria Rossi' }], error: null }).then(ok, ko);
    };
    return q;
  };
  const rpc = async () => funzione === 'manca'
    ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.nomi_dei_clienti_del_negozio(p_ids) in the schema cache' } }
    : { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
  return { from, rpc };
}

const avvisiCon = (pezzo: string) =>
  vi.mocked(logger.warn).mock.calls.filter((c) => String(c[0]).includes(pezzo)).length;

beforeEach(() => vi.mocked(logger.warn).mockClear());

describe('R06-004 · senza la 181 l’avviso «funzione assente» non si ripete a ogni chiamata', () => {
  it('cinque aperture della chat: il nome arriva ogni volta, l’avviso una volta sola', async () => {
    const letti = { quante: 0 };
    const client = database('manca', letti);
    for (let i = 0; i < 5; i++) {
      const nomi = await fetchNomiDeiClienti(client, [MARIA]);
      expect(nomi.get(MARIA), 'il ripiego deve lavorare a ogni chiamata').toBe('Maria Rossi');
    }
    expect(letti.quante, 'il ripiego legge gli ordini a ogni chiamata').toBe(5);
    expect(avvisiCon('migrazione 181 non applicata'), 'ogni apertura scrive lo stesso avviso nel registro').toBe(1);
  });

  it('un guasto vero della funzione resta nel registro ogni volta', async () => {
    const client = database('guasto', { quante: 0 });
    for (let i = 0; i < 3; i++) await fetchNomiDeiClienti(client, [MARIA]);
    expect(avvisiCon('nomi dei clienti non letti')).toBe(3);
  });
});
