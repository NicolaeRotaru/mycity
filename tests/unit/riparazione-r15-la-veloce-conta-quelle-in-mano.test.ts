import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { veloceSiPuo } from '@/lib/ordini/consegna-veloce';

/**
 * R15-015 — La consegna veloce si vendeva a tutti insieme anche con un solo fattorino.
 *
 * `veloceSiPuo` guardava solo se c'era almeno un fattorino acceso: con un fattorino solo, dieci
 * clienti alle 12:00 ricevevano tutti «arrivo in 30-60 minuti». Adesso la decisione riceve anche le
 * veloci già vendute e non consegnate, e le confronta con fattorini × veloci per fattorino.
 *
 * Quante veloci può portare un fattorino non è deciso (scelta di Nicola): qui il numero si passa a
 * mano, e l'ultima prova dice che senza quel numero la veloce si decide come prima.
 */

const MEZZOGIORNO = new Date(2026, 10, 13, 12, 0);
const SEMPRE_APERTO = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [['00:00', '23:59']]]),
);
const NEGOZI = [{ nome: 'Pane Quotidiano', orari: SEMPRE_APERTO }];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MEZZOGIORNO);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Dieci clienti in fila alle 12:00: ognuno che riceve il sì aggiunge una veloce in mano ai fattorini. */
function dieciClienti(fattoriniOnline: number, velociPerFattorino: number) {
  let inCorso = 0;
  const no: string[] = [];
  for (let i = 0; i < 10; i++) {
    const esito = veloceSiPuo({ adesso: MEZZOGIORNO, negozi: NEGOZI, fattoriniOnline, velociInCorso: inCorso, velociPerFattorino });
    if (esito.possibile) inCorso++;
    else no.push(esito.perche);
  }
  return { vendute: inCorso, no };
}

describe('R15-015 — la veloce conta quelle che i fattorini hanno già in mano', () => {
  it('un fattorino solo che ne porta due: alle 12:00 la veloce la ricevono due clienti, non dieci', () => {
    const { vendute, no } = dieciClienti(1, 2);
    expect(vendute, 'dieci «arrivo in 30-60 minuti» con un fattorino solo').toBe(2);
    expect(no).toHaveLength(8);
    expect(no[0]).toContain('hanno già in mano');
    expect(no[0]).toContain('Scegli una fascia oraria');
  });

  it('due fattorini accesi da una veloce ciascuno: due vendute', () => {
    expect(dieciClienti(2, 1).vendute).toBe(2);
  });

  it('con posto libero la veloce c’è ancora', () => {
    const esito = veloceSiPuo({ adesso: MEZZOGIORNO, negozi: NEGOZI, fattoriniOnline: 3, velociInCorso: 2, velociPerFattorino: 1 });
    expect(esito.possibile).toBe(true);
  });

  it('se il conteggio delle veloci in corso cade, non si promette alla cieca', () => {
    const esito = veloceSiPuo({ adesso: MEZZOGIORNO, negozi: NEGOZI, fattoriniOnline: 5, velociInCorso: null, velociPerFattorino: 2 });
    expect(esito.possibile).toBe(false);
    if (!esito.possibile) expect(esito.perche).toContain('non riesco a confermare');
  });

  it('finché Nicola non sceglie quante veloci porta un fattorino, il conteggio non decide', () => {
    const esito = veloceSiPuo({ adesso: MEZZOGIORNO, negozi: NEGOZI, fattoriniOnline: 1, velociInCorso: 50 });
    expect(esito.possibile).toBe(true);
  });
});
