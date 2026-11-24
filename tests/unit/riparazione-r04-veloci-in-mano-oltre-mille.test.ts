import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contaFattoriniOnline, contaVelociInCorso } from '@/lib/ordini/consegna-veloce';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * R04-013 — Il conteggio delle veloci in mano chiedeva al database TUTTE le veloci in uno stato
 * aperto, di sempre, e la finestra delle ultime tre ore la applicava dopo, sulle righe arrivate.
 * Il servizio dati ne restituisce al massimo 1000 per richiesta: con più di mille veloci
 * dimenticate le veloci vere di adesso restavano fuori, e il conteggio usciva basso.
 *
 * Il database finto fa come quello vero: applica eq, in e gte, risponde al massimo 1000 righe
 * (le più vecchie prima) e, se gli si chiede `count: 'exact'`, dà il numero vero delle righe
 * che rispondono ai filtri. Orologio finto: il 24/11 alle 12:00 di Piacenza.
 */

const ADESSO = new Date('2026-11-24T11:00:00.000Z');
const RIGHE_MASSIME = 1000;

type Riga = { delivery_slot: string; delivery_status: string; created_at: string; user_id: string };

const letture = { ordini: 0 };

function dbFinto(ordini: Riga[], fattoriniAccesi = 0) {
  return {
    from(tabella: string) {
      const filtri: Array<(r: Record<string, unknown>) => boolean> = [];
      let soloConteggio = false;
      let conConteggio = false;
      const q = {
        select: (_c: string, o?: { head?: boolean; count?: string }) => {
          soloConteggio = !!o?.head;
          conConteggio = o?.count === 'exact';
          return q;
        },
        eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filtri.push((r) => v.includes(r[c])), q),
        gte: (c: string, v: string) => (filtri.push((r) => String(r[c] ?? '') >= v), q),
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (tabella === 'profiles') {
            return Promise.resolve(soloConteggio ? { count: fattoriniAccesi, error: null } : { data: [], error: null }).then(ok, ko);
          }
          letture.ordini += 1;
          const tutte = (ordini as Array<Record<string, unknown>>).filter((r) => filtri.every((f) => f(r)));
          return Promise.resolve({
            data: tutte.slice(0, RIGHE_MASSIME),
            count: conConteggio ? tutte.length : null,
            error: null,
          }).then(ok, ko);
        },
      };
      return q;
    },
  };
}

/** 1200 veloci dimenticate (ferme dal 16/11, ognuna di un cliente diverso), prima delle altre. */
function conDimenticate(altre: Riga[]): Riga[] {
  const dimenticate = Array.from({ length: 1200 }, (_, i): Riga => ({
    delivery_slot: ETICHETTA_ADESSO,
    delivery_status: 'ACCEPTED',
    created_at: '2026-11-16T10:00:00.000Z',
    user_id: `vecchio-${i}`,
  }));
  return [...dimenticate, ...altre];
}

const vera = (cliente: string, nata: string): Riga => ({
  delivery_slot: ETICHETTA_ADESSO, delivery_status: 'PICKED_UP', created_at: nata, user_id: cliente,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  letture.ordini = 0;
});
afterEach(() => vi.useRealTimers());

describe('R04-013 · le veloci in mano si contano anche oltre mille righe', () => {
  it('con 1200 veloci dimenticate le due veloci di adesso contano ancora', async () => {
    const ordini = conDimenticate([vera('anna', '2026-11-24T10:30:00.000Z'), vera('bruno', '2026-11-24T09:15:00.000Z')]);
    expect(await contaVelociInCorso(dbFinto(ordini) as never)).toBe(2);
  });

  it('due fattorini accesi con due veloci in mano: nessuno è libero, anche con 1200 veloci vecchie', async () => {
    const ordini = conDimenticate([vera('anna', '2026-11-24T10:30:00.000Z'), vera('bruno', '2026-11-24T10:45:00.000Z')]);
    expect(await contaFattoriniOnline(dbFinto(ordini, 2) as never, ADESSO)).toBe(0);
  });

  it('più di mille veloci di adesso: il numero non si sa, e non vale un numero basso', async () => {
    const recenti = Array.from({ length: 1001 }, (_, i) => vera(`cliente-${i}`, '2026-11-24T10:00:00.000Z'));
    expect(await contaVelociInCorso(dbFinto(conDimenticate(recenti)) as never)).toBeNull();
    expect(await contaFattoriniOnline(dbFinto(recenti, 3) as never, ADESSO)).toBeNull();
  });

  it('sotto le mille righe una lettura sola, e il confine resta tre ore', async () => {
    const ordini = [vera('carla', '2026-11-24T07:59:00.000Z'), vera('dario', '2026-11-24T08:01:00.000Z')];
    expect(await contaVelociInCorso(dbFinto(ordini) as never)).toBe(1);
    expect(letture.ordini).toBe(1);
  });
});
