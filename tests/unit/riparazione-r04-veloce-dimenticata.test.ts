import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contaVelociInCorso, veloceSiPuo } from '@/lib/ordini/consegna-veloce';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * R04-020 — Il conteggio delle veloci in corso non aveva una finestra di tempo: con il tetto a una
 * veloce per fattorino, una veloce dimenticata in uno stato aperto spegneva la veloce per giorni.
 * L'esempio del collaudo: un «Adesso» fermo dal 16/11 dava 409 il 19/11.
 *
 * Adesso si contano solo le veloci nate nelle ultime tre ore (`ORE_PER_ACCETTARE`, la vita più
 * lunga che il sito dà a una veloce). Orologio finto: il 19/11 alle 12:00 di Piacenza.
 */

const ADESSO = new Date('2026-11-19T11:00:00.000Z');
const ORA_DI_PIACENZA = new Date(2026, 10, 19, 12, 0);
const SEMPRE_APERTO = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [['00:00', '23:59']]]),
);

type Riga = { delivery_slot: string; delivery_status: string; created_at: string; user_id?: string };

/** Un database finto che applica davvero eq, in e gte, e risponde le righe e il loro conteggio. */
function dbFinto(ordini: Riga[]) {
  return {
    from() {
      const filtri: Array<(r: Riga) => boolean> = [];
      const q = {
        select: () => q,
        eq: (c: keyof Riga, v: unknown) => (filtri.push((r) => r[c] === v), q),
        in: (c: keyof Riga, v: unknown[]) => (filtri.push((r) => v.includes(r[c])), q),
        gte: (c: keyof Riga, v: string) => (filtri.push((r) => String(r[c] ?? '') >= v), q),
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          const righe = ordini.filter((r) => filtri.every((f) => f(r)));
          return Promise.resolve({ data: righe, count: righe.length, error: null }).then(ok, ko);
        },
      };
      return q;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
});
afterEach(() => vi.useRealTimers());

describe('R04-020 · una veloce dimenticata non spegne la veloce', () => {
  it('un «Adesso» fermo dal 16/11 non conta il 19/11, e con un fattorino solo la veloce si vende', async () => {
    const dimenticata: Riga = { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'ACCEPTED', created_at: '2026-11-16T10:00:00.000Z' };
    const velociInCorso = await contaVelociInCorso(dbFinto([dimenticata]) as never);
    expect(velociInCorso, 'la veloce del 16/11 conta ancora il 19/11').toBe(0);
    const esito = veloceSiPuo({
      adesso: ORA_DI_PIACENZA,
      negozi: [{ nome: 'Pane Quotidiano', orari: SEMPRE_APERTO }],
      fattoriniOnline: 1,
      velociInCorso,
      velociPerFattorino: 1,
    });
    expect(esito.possibile).toBe(true);
  });

  it('una veloce vera, anche in ritardo (nata due ore e mezza fa), conta ancora', async () => {
    const inRitardo: Riga = { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'PICKED_UP', created_at: '2026-11-19T08:30:00.000Z' };
    expect(await contaVelociInCorso(dbFinto([inRitardo]) as never)).toBe(1);
  });

  it('il confine sono le tre ore: nata tre ore e un minuto fa non conta', async () => {
    const oltre: Riga = { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'READY', created_at: '2026-11-19T07:59:00.000Z', user_id: 'anna' };
    const dentro: Riga = { delivery_slot: ETICHETTA_ADESSO, delivery_status: 'READY', created_at: '2026-11-19T08:01:00.000Z', user_id: 'bruno' };
    expect(await contaVelociInCorso(dbFinto([oltre, dentro]) as never)).toBe(1);
  });
});
