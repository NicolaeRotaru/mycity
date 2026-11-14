import { describe, expect, it } from 'vitest';
import { erroreDegliOrari, erroreDelleFasce, prossimaFascia } from '@/components/seller/orari-validi';
import type { HoursInterval } from '@/lib/store-hours';

/** R23-015 — Il negozio aperto fino a mezzanotte scrive 18:00–00:00 e il salvataggio non lo ferma. */
describe('R23-015 — la chiusura a mezzanotte', () => {
  it('18:00–00:00 è valida', () => {
    expect(erroreDelleFasce([['18:00', '00:00']])).toBeNull();
    expect(erroreDegliOrari({ fri: [['18:00', '00:00']] })).toBeNull();
  });
  it('00:00–00:00 e le chiusure prima dell\'apertura restano errori', () => {
    expect(erroreDelleFasce([['00:00', '00:00']])).toMatch(/dopo quello di apertura/);
    expect(erroreDelleFasce([['13:00', '09:00']])).toMatch(/dopo quello di apertura/);
  });
  it('la fascia che arriva a mezzanotte si sovrappone a una che parte prima', () => {
    expect(erroreDelleFasce([['18:00', '00:00'], ['20:00', '22:00']])).toMatch(/sovrappongono/);
  });
  it('il messaggio dice come chiudere a mezzanotte', () => {
    expect(erroreDelleFasce([['16:30', '07:30']])).toMatch(/23:59/);
  });
});

/**
 * R23-015 correzione (14/11/2026) — Dopo 18:00–00:00, «aggiungi fascia» proponeva 03:00–06:00: il
 * controllo la accettava e, salvata, il negozio risultava aperto e ordinabile dalle 3 alle 6 di notte.
 * La proposta che segue una fascia fino a mezzanotte non deve mai essere una fascia notturna che si
 * salva senza un avviso.
 */
describe('R23-015 correzione — la fascia proposta dopo una chiusura a mezzanotte', () => {
  const dopo = (fasce: HoursInterval[]) => {
    const proposta = prossimaFascia(fasce);
    return { proposta, errore: erroreDelleFasce([...fasce, proposta]) };
  };

  it('dopo 18:00–00:00 non propone le 3 di notte', () => {
    const { proposta } = dopo([['18:00', '00:00']]);
    expect(proposta, 'la proposta cade nella notte dopo la chiusura').not.toEqual(['03:00', '06:00']);
    expect(proposta).toEqual(['22:00', '23:59']);
  });

  it('la proposta dopo una chiusura a mezzanotte non si salva in silenzio: il controllo la ferma', () => {
    for (const fasce of [
      [['18:00', '00:00']],
      [['08:00', '12:00'], ['18:00', '00:00']],
      [['21:00', '00:00']],
      [['00:30', '00:00']],
    ] as HoursInterval[][]) {
      const { proposta, errore } = dopo(fasce);
      expect(errore, `${JSON.stringify(fasce)} + ${JSON.stringify(proposta)} passa il controllo`).toMatch(/sovrappongono/);
    }
  });

  it('la regola è la stessa di un 23:00: niente cambia per chi chiude prima di mezzanotte', () => {
    expect(prossimaFascia([['18:00', '23:00']])).toEqual(['22:00', '23:59']);
    expect(prossimaFascia([['09:00', '13:00']])).toEqual(['16:00', '19:00']);
    expect(prossimaFascia([['08:00', '12:00'], ['15:00', '19:00']])).toEqual(['22:00', '23:59']);
    expect(prossimaFascia([])).toEqual(['09:00', '13:00']);
    expect(prossimaFascia(undefined)).toEqual(['09:00', '13:00']);
  });

  it('una fascia che apre a mezzanotte e chiude al mattino resta letta col suo orario', () => {
    // 00:00–08:00: «00:00» qui è l'apertura, non la chiusura. La proposta riparte dalle 11.
    expect(prossimaFascia([['00:00', '08:00']])).toEqual(['11:00', '14:00']);
  });
});

/**
 * R23-015 correzione, verifica (14/11/2026) — La stessa strada passava ancora da un'apertura vuota o non
 * valida: con l'ultima fascia ['', '00:00'] (apertura svuotata mentre si riscrive) o ['00:00', '00:00'] la
 * proposta tornava 03:00–06:00, e rimessa l'apertura 18:00 il controllo la lasciava salvare.
 */
describe("R23-015 correzione — la proposta non torna alla notte con l'apertura vuota", () => {
  it.each([
    [['', '00:00']],
    [['00:00', '00:00']],
    [['xx', '00:00']],
    [['09:00', '12:00'], ['', '00:00']],
  ] as HoursInterval[][])('dopo %j non propone 03:00–06:00', (...fasce) => {
    const proposta = prossimaFascia(fasce);
    expect(proposta, 'la proposta cade nella notte').toEqual(['22:00', '23:59']);
    // Il negoziante rimette l'apertura: la proposta non passa il controllo in silenzio.
    const rimesse = fasce.map(([a, c]) => [a === '' || a === 'xx' || a === '00:00' ? '18:00' : a, c] as HoursInterval);
    expect(erroreDelleFasce([...rimesse, proposta])).toMatch(/sovrappongono/);
  });
});
