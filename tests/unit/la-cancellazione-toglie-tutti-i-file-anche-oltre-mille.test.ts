import { describe, it, expect, vi } from 'vitest';

/**
 * 1/11/2026 — LA CANCELLAZIONE DELL'ACCOUNT TOGLIE TUTTI I FILE, E SE NON CI
 * RIESCE LO DICE.
 *
 * `cancellaFilePersonali` chiedeva allo storage UNA pagina da 1000: oltre i
 * 1000 file di una persona il resto restava. E l'elenco di una sottocartella
 * buttava via l'errore: la cartella restava piena e il conto diceva «rimossi».
 */

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({}) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { cancellaFilePersonali } from '@/lib/account/cancellazione';

type Voce = { name: string; id: string | null };

/** Un finto storage che pagina come quello vero e ricorda cosa e' stato tolto. */
function fintoStorage(cartelle: Record<string, Voce[]>, elenchiRotti: string[] = []) {
  const tolti = new Set<string>();
  const admin = {
    storage: {
      from: (secchio: string) => ({
        list: async (cartella: string, opzioni?: { limit?: number; offset?: number }) => {
          const chiave = `${secchio}:${cartella}`;
          if (elenchiRotti.includes(chiave)) return { data: null, error: { message: 'timeout' } };
          const tutte = cartelle[chiave] ?? [];
          const da = opzioni?.offset ?? 0;
          // Senza `limit` lo storage vero ne restituisce 100.
          return { data: tutte.slice(da, da + (opzioni?.limit ?? 100)), error: null };
        },
        remove: async (percorsi: string[]) => {
          for (const p of percorsi) tolti.add(`${secchio}:${p}`);
          return { data: [], error: null };
        },
      }),
    },
  };
  return { admin: admin as never, tolti };
}

const file = (n: number): Voce[] =>
  Array.from({ length: n }, (_, i) => ({ name: `f${String(i).padStart(5, '0')}.jpg`, id: `id-${i}` }));

describe('cancellaFilePersonali', () => {
  it('IL CASO CHE ROMPEVA — 1500 file di una persona: si tolgono tutti e 1500', async () => {
    const { admin, tolti } = fintoStorage({ 'reviews:u1': file(1500) });
    const esito = await cancellaFilePersonali(admin, 'u1');
    expect(esito.errori).toEqual([]);
    expect(esito.rimossi).toBe(1500);
    expect(tolti.size).toBe(1500);
    expect(tolti.has('reviews:u1/f01499.jpg')).toBe(true);
  });

  it('anche dentro una sottocartella oltre i 1000 file', async () => {
    const { admin, tolti } = fintoStorage({
      'cod-proof:u1': [{ name: 'ordine-1', id: null }],
      'cod-proof:u1/ordine-1': file(1200),
    });
    const esito = await cancellaFilePersonali(admin, 'u1');
    expect(esito.errori).toEqual([]);
    expect(tolti.size).toBe(1200);
  });

  it('IL CASO CHE ROMPEVA — l elenco di una sottocartella fallisce: l esito lo dice, e non conta quei file come rimossi', async () => {
    const { admin, tolti } = fintoStorage(
      {
        'kyc-docs:u1': [{ name: 'fronte.jpg', id: 'a' }, { name: 'vecchi', id: null }],
        'kyc-docs:u1/vecchi': file(3),
      },
      ['kyc-docs:u1/vecchi'],
    );
    const esito = await cancellaFilePersonali(admin, 'u1');
    expect(esito.errori.length, 'un elenco fallito passava per una cancellazione riuscita').toBeGreaterThan(0);
    expect(esito.errori.join(' ')).toContain('vecchi');
    // Il file che si e' potuto leggere si toglie lo stesso.
    expect([...tolti]).toEqual(['kyc-docs:u1/fronte.jpg']);
    expect(esito.rimossi).toBe(1);
  });
});
