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

/**
 * R23-015 correzione, seconda verifica (14/11/2026) — Restava la stessa strada con una chiusura dopo
 * mezzanotte: un bar che scrive 18:00–01:00 (riga sbagliata) si sentiva proporre 04:00–07:00; corretta la
 * chiusura in 00:00 o 23:59, come chiede il messaggio d'errore, la fascia delle 4 di notte passava il
 * controllo. Una riga che non è una fascia valida dello stesso giorno, per la proposta, finisce a mezzanotte.
 */
describe('R23-015 correzione — la proposta dopo una riga sbagliata che passa la mezzanotte', () => {
  const ore = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  it('18:00–01:00 corretta in 00:00 o 23:59: la proposta non si salva in silenzio', () => {
    for (const [a, c] of [['18:00', '01:00'], ['12:00', '00:30'], ['20:00', '02:59'], ['23:00', '00:01']]) {
      const proposta = prossimaFascia([[a, c]]);
      for (const corretta of ['00:00', '23:59']) {
        expect(
          erroreDelleFasce([[a, corretta], proposta]),
          `${a}–${c} propone ${proposta.join('–')}, e corretta in ${a}–${corretta} passa il controllo`,
        ).toMatch(/sovrappongono/);
      }
    }
  });

  it('nessuna riga sbagliata fa proporre una fascia di notte', () => {
    for (let apre = 0; apre < 24 * 60; apre += 30) {
      for (let chiude = 0; chiude < 24 * 60; chiude += 5) {
        if (chiude > apre) continue; // riga valida dello stesso giorno: non è il caso di questa prova
        for (const prima of [[], [['08:00', '12:00']]] as HoursInterval[][]) {
          const proposta = prossimaFascia([...prima, [ore(apre), ore(chiude)]]);
          expect(proposta, `dopo ${ore(apre)}–${ore(chiude)}`).toEqual(['22:00', '23:59']);
        }
      }
    }
  });

  it('una fascia di notte valida, scritta apposta, resta letta col suo orario', () => {
    expect(prossimaFascia([['00:00', '02:00']])).toEqual(['05:00', '08:00']);
    expect(prossimaFascia([['18:00', '00:00'], ['01:00', '02:00']])).toEqual(['05:00', '08:00']);
  });
});
