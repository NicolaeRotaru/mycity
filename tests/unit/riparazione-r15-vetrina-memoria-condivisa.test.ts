/**
 * @vitest-environment jsdom
 */
/**
 * R15-002 — In home ogni sezione chiedeva di nuovo alla vetrina lo stesso negozio, anche a volo
 * atterrato. Ora la risposta si tiene qualche minuto per client: due chiamate per lo stesso negozio,
 * una sola lettura; scaduta la memoria, di nuovo una lettura.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSellerPublicMap } from '@/lib/queries/seller-public-profiles';

const DIECI_MINUTI = 10 * 60 * 1000;

const PANE = { id: 'pane', store_name: 'Pane Quotidiano', is_approved: true };
const LATTE = { id: 'latte', store_name: 'Latteria', is_approved: true };

function vetrina(righe = [PANE, LATTE], cade = { si: false }) {
  const domande: string[][] = [];
  const client = {
    from: () => ({
      select: () => ({
        in: (_c: string, ids: string[]) => {
          domande.push([...ids]);
          return Promise.resolve(
            cade.si ? { data: null, error: { message: 'giu' } } : { data: righe.filter((r) => ids.includes(r.id)), error: null },
          );
        },
      }),
    }),
  };
  return { client, domande };
}

afterEach(() => vi.useRealTimers());

describe('R15-002 · la vetrina tiene il negozio qualche minuto', () => {
  it('due chiamate una dopo l’altra per lo stesso negozio: una sola lettura', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { client, domande } = vetrina();
    const a = await fetchSellerPublicMap(client, ['pane']);
    vi.setSystemTime(Date.now() + 30_000);
    const b = await fetchSellerPublicMap(client, ['pane']);
    expect(a.get('pane')?.store_name).toBe('Pane Quotidiano');
    expect(b.get('pane')?.store_name).toBe('Pane Quotidiano');
    expect(domande).toEqual([['pane']]);
  });

  it('un negozio nuovo in una chiamata successiva si chiede da solo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { client, domande } = vetrina();
    await fetchSellerPublicMap(client, ['pane']);
    const m = await fetchSellerPublicMap(client, ['pane', 'latte']);
    expect(m.size).toBe(2);
    expect(domande).toEqual([['pane'], ['latte']]);
  });

  it('dopo la scadenza si rilegge dal database', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { client, domande } = vetrina();
    await fetchSellerPublicMap(client, ['pane']);
    vi.setSystemTime(Date.now() + DIECI_MINUTI);
    await fetchSellerPublicMap(client, ['pane']);
    expect(domande.length).toBe(2);
  });

  it('una lettura caduta non si tiene in memoria', async () => {
    const cade = { si: true };
    const { client, domande } = vetrina([PANE, LATTE], cade);
    await expect(fetchSellerPublicMap(client, ['pane'])).rejects.toBeTruthy();
    cade.si = false;
    const m = await fetchSellerPublicMap(client, ['pane']);
    expect(m.size).toBe(1);
    expect(domande.length).toBe(2);
  });

  it('client diversi non si scambiano la memoria', async () => {
    const a = vetrina();
    const b = vetrina();
    await fetchSellerPublicMap(a.client, ['pane']);
    await fetchSellerPublicMap(b.client, ['pane']);
    expect(a.domande.length + b.domande.length).toBe(2);
  });
});
