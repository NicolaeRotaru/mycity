import { describe, it, expect } from 'vitest';
import { contaVelociInCorso } from '@/lib/ordini/consegna-veloce';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * R15-015 — Il conteggio delle veloci già vendute e non ancora consegnate.
 *
 * Si contano gli ordini con la fascia «Adesso» in uno stato fra il nuovo e il «in strada»: quelli
 * consegnati o annullati non occupano più un fattorino, quelli di un'altra fascia non sono veloci.
 * Una lettura caduta non vale zero.
 */

type Riga = { delivery_slot: string | null; delivery_status: string };

function dbFinto(ordini: Riga[], rotto: 'errore' | 'eccezione' | 'senza-numero' | null = null) {
  return {
    from(tabella: string) {
      const eq: Array<[string, unknown]> = [];
      const dentro: Array<[string, unknown[]]> = [];
      let soloConteggio = false;
      const q = {
        select: (_c: string, o?: { count?: string; head?: boolean }) => {
          soloConteggio = !!o?.head && o?.count === 'exact';
          return q;
        },
        eq: (c: string, v: unknown) => {
          eq.push([c, v]);
          return q;
        },
        in: (c: string, v: unknown[]) => {
          dentro.push([c, v]);
          return q;
        },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (rotto === 'eccezione') return Promise.reject(new Error('rete giù')).then(ok, ko);
          if (rotto === 'errore') return Promise.resolve({ count: null, error: { message: 'giù' } }).then(ok, ko);
          if (rotto === 'senza-numero') return Promise.resolve({ count: null, error: null }).then(ok, ko);
          const righe = tabella !== 'orders'
            ? []
            : ordini.filter(
                (r) =>
                  eq.every(([c, v]) => (r as Record<string, unknown>)[c] === v) &&
                  dentro.every(([c, v]) => v.includes((r as Record<string, unknown>)[c])),
              );
          return Promise.resolve(soloConteggio ? { count: righe.length, error: null } : { data: righe, error: null }).then(ok, ko);
        },
      };
      return q;
    },
  };
}

describe('R15-015 — contaVelociInCorso', () => {
  it('conta le veloci vendute e non finite, non le consegnate, le annullate o le altre fasce', async () => {
    const ordini: Riga[] = [
      { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'NEW' },
      { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'ACCEPTED' },
      { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'READY' },
      { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'ASSIGNED' },
      { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'PICKED_UP' },
      { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'OUT_FOR_DELIVERY' },
      { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'DELIVERED' },
      { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'CANCELED' },
      { delivery_slot: 'In giornata · 15:00–18:00', delivery_status: 'ASSIGNED' },
      { delivery_slot: null, delivery_status: 'READY' },
    ];
    expect(await contaVelociInCorso(dbFinto(ordini) as never)).toBe(6);
  });

  it('nessuna veloce in corso è zero, non «non so»', async () => {
    expect(await contaVelociInCorso(dbFinto([]) as never)).toBe(0);
  });

  it('una lettura caduta non vale zero', async () => {
    expect(await contaVelociInCorso(dbFinto([], 'errore') as never)).toBeNull();
    expect(await contaVelociInCorso(dbFinto([], 'eccezione') as never)).toBeNull();
    expect(await contaVelociInCorso(dbFinto([], 'senza-numero') as never)).toBeNull();
  });
});
