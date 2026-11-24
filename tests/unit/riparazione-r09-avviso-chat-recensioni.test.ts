import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R09-002 — Senza la migrazione 181 la chat (e la pagina delle recensioni) scriveva l'avviso «nomi dei
 * clienti non letti» a OGNI apertura. Adesso una volta per processo (e per pagina) se la funzione manca;
 * un guasto vero resta nel registro ogni volta. In entrambi i casi il nome resta assente («Cliente»).
 */
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const MARIA = 'u-maria';
const PANE = 'n-pane';

function database(caso: 'manca' | 'guasto') {
  const from = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q; q.in = () => q; q.order = () => q; q.limit = () => q; q.eq = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: PANE, store_name: 'Pane' }], error: null }).then(ok, ko);
    return q;
  };
  const rpc = async () => caso === 'manca'
    ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.nomi_dei_clienti_del_negozio(p_ids) in the schema cache' } }
    : { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
  return { from, rpc };
}

async function carica() {
  vi.resetModules();
  const { logger } = await import('@/lib/logger');
  const chat = await import('@/lib/queries/controparte-della-chat');
  vi.mocked(logger.warn).mockClear();
  return { logger, chat };
}
const conv = [{ seller_id: PANE, buyer_id: MARIA }];
beforeEach(() => vi.clearAllMocks());

describe('R09-002 · la chat non ripete l\'avviso della funzione assente', () => {
  it('senza la 181: due aperture, un solo avviso, e il cliente resta senza nome', async () => {
    const { logger, chat } = await carica();
    const supa = database('manca');
    const a = await chat.conInsegnaDelNegozio(supa, conv, PANE);
    const b = await chat.conInsegnaDelNegozio(supa, conv, PANE);
    expect(a[0].cliente).toBeNull();
    expect(b[0].cliente).toBeNull();
    expect(vi.mocked(logger.warn).mock.calls.filter((c) => /nomi dei clienti/.test(String(c[0])))).toHaveLength(1);
  });

  it('un guasto vero: un avviso a ogni apertura', async () => {
    const { logger, chat } = await carica();
    const supa = database('guasto');
    await chat.conInsegnaDelNegozio(supa, conv, PANE);
    await chat.conInsegnaDelNegozio(supa, conv, PANE);
    expect(vi.mocked(logger.warn).mock.calls.filter((c) => /nomi dei clienti/.test(String(c[0])))).toHaveLength(2);
  });
});
