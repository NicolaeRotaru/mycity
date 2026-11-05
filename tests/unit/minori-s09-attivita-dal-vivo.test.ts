/**
 * S09 — «Cosa sta succedendo a Piacenza» (scheda 285): l'ora arriva arrotondata all'inizio
 * dell'ora, quindi non si dicono minuti che non si conoscono.
 */
import { describe, it, expect } from 'vitest';
import { quandoNellaFascia } from '@/components/LiveActivityFeed';

describe('285 — la fascia oraria invece dei minuti', () => {
  it("un ordine delle 14:55 visto alle 14:58 è «nell'ultima ora», non «58 min fa»", () => {
    const inizio = '2026-11-05T13:00:00Z'; // 14:00 a Roma
    const adesso = Date.parse('2026-11-05T13:58:00Z');
    expect(quandoNellaFascia(inizio, adesso)).toEqual({ testo: "nell'ultima ora", inQuestOra: true });
  });
  it('un ordine dell\'ora prima dice la fascia, in ora di Roma', () => {
    const inizio = '2026-11-05T13:00:00Z';
    const adesso = Date.parse('2026-11-05T14:50:00Z');
    expect(quandoNellaFascia(inizio, adesso)).toEqual({ testo: 'tra le 14 e le 15', inQuestOra: false });
  });
});
