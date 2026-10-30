/**
 * 30/10/2026 (collaudo dell'ondata 22) — IL RITIRO CHIEDE UN QUARTO D'ORA DI NEGOZIO APERTO.
 *
 * Il difetto: la regola del ritiro diceva «il negozio è aperto in UN MOMENTO fra l'ordine e 60
 * minuti prima della fine della fascia». Un momento solo bastava. Lunedì alle 12:50 la rotta
 * accettava «Oggi · 13:00–16:30» per Pane Quotidiano, e alle 12:55 il freno della veloce ci
 * spostava la spesa: il forno chiude alle 13:00 e riapre alle 16:30, quando la fascia è finita.
 * Restavano 5-10 minuti per accettare, preparare la busta e farla ritirare. Nessuno ce la fa, e
 * l'ordine moriva alle 16:30 (con la carta: addebito e rimborso).
 *
 * La regola giusta: dal momento del ritiro il negozio deve restare aperto almeno
 * `MINUTI_PER_IL_RITIRO` (15). Il caso 7 di Nicola (lunedì 19:15, la 19:30–21:00 sì: forno aperto
 * fino alle 19:30) è esattamente un quarto d'ora, e resta vero.
 *
 * Pane Quotidiano: lun-sab 9-13 e 16:30-19:30, giovedì pomeriggio e domenica chiuso. Le Date sono
 * l'orologio di Roma (lunedì 2/11/2026).
 */
import { describe, it, expect } from 'vitest';
import { fasceAncoraPossibili } from '@/lib/quando-arriva';
import { negozioPuoServire } from '@/lib/store-hours';
import { consegnaDellaVetrina } from '@/lib/promessa-consegna';
import { fasciaDopoLaVeloce } from '@/lib/ordini/veloce-non-confermata';

const GIORNATA: [string, string][] = [['09:00', '13:00'], ['16:30', '19:30']];
const PQ = { mon: GIORNATA, tue: GIORNATA, wed: GIORNATA, thu: [['09:00', '13:00']], fri: GIORNATA, sat: GIORNATA };
const lunedi = (h: number, m = 0) => new Date(2026, 10, 2, h, m);

describe('il ritiro chiede un quarto d’ora di negozio aperto', () => {
  it('lunedì alle 12:50 le rotte (stessa regola) rifiutano la 13:00–16:30: il forno chiude fra 10 minuti', () => {
    expect(negozioPuoServire(PQ, 'Oggi · 13:00–16:30', lunedi(12, 50))).toBe(false);
    expect(fasceAncoraPossibili(lunedi(12, 50), [PQ])).not.toContain('Oggi · 13:00–16:30');
  });

  it('lunedì alle 12:55 il freno della veloce non sposta la spesa sulla 13:00–16:30, ma sulla 16:30–18:00', () => {
    expect(fasciaDopoLaVeloce(lunedi(12, 55), [PQ])).toBe('Oggi · 16:30–18:00');
  });

  it('alle 12:45 c’è ancora un quarto d’ora: la 13:00–16:30 si sceglie (caso 1 di Nicola, al limite)', () => {
    expect(fasceAncoraPossibili(lunedi(12, 45), [PQ])).toContain('Oggi · 13:00–16:30');
    expect(negozioPuoServire(PQ, 'Oggi · 13:00–16:30', lunedi(12, 45))).toBe(true);
    expect(negozioPuoServire(PQ, 'Oggi · 13:00–16:30', lunedi(12, 0))).toBe(true);
  });

  it('caso 7: alle 19:15 la 19:30–21:00 c’è e la vetrina dice «oggi»; alle 19:16 no, e la vetrina lo sa', () => {
    expect(fasceAncoraPossibili(lunedi(19, 15), [PQ])).toEqual(['Oggi · 19:30–21:00']);
    expect(consegnaDellaVetrina({ orari: PQ, adesso: lunedi(19, 15), veloce: false })).toBe('oggi');
    expect(fasceAncoraPossibili(lunedi(19, 16), [PQ])).toEqual([]);
    expect(negozioPuoServire(PQ, 'Oggi · 19:30–21:00', lunedi(19, 16))).toBe(false);
    expect(consegnaDellaVetrina({ orari: PQ, adesso: lunedi(19, 16), veloce: false })).not.toBe('oggi');
  });

  it('caso 4 resta: alle 17:00 la 16:30–18:00 c’è (il forno resta aperto fino alle 19:30)', () => {
    expect(fasceAncoraPossibili(lunedi(17, 0), [PQ])).toContain('Oggi · 16:30–18:00');
  });

  it('per domani vale lo stesso quarto d’ora: un negozio aperto solo 7:50-8:00 non serve la 7:30–9:00', () => {
    const corto = { tue: [['07:50', '08:00'], ['09:00', '12:00']] };
    expect(negozioPuoServire(corto, 'Domani · 7:30–9:00', lunedi(20))).toBe(false);
    expect(negozioPuoServire({ tue: [['07:00', '12:00']] }, 'Domani · 7:30–9:00', lunedi(20))).toBe(true);
  });
});
