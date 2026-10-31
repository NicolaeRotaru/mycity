/**
 * 31/10/2026 (ondata 3) — CHIUSO PER FERIE: LA SCHEDA PRODOTTO DICE QUELLO CHE DICE LA CASSA.
 *
 * Il sito non ha un pulsante «ferie»: il negoziante preme «Chiudi» su ogni giorno e l'editor degli
 * orari scrive la settimana intera con sette liste vuote. Dal primo giro la cassa la legge come
 * «tutto chiuso» e rifiuta l'ordine; la scheda prodotto invece usava una copia della regola
 * (`haOrari`) che contava solo i giorni con delle ore, e scriveva ancora «Consegna a casa, all'ora
 * che scegli». Sabato 31/10 alle 10:00 il cliente leggeva la promessa e poi trovava la cassa ferma.
 *
 * Usa solo nomi che c'erano già: rossa sul codice di prima, verde con la regola unica.
 */
import { describe, expect, it } from 'vitest';
import {
  consegnaDellaVetrina,
  haOrari,
  promessaDiConsegna,
  rigaConsegnaDellaScheda,
} from '@/lib/promessa-consegna';
import { isStoreClosedForOrder } from '@/lib/store-hours';

/** Quello che scrive l'editor degli orari quando ogni giorno è «Chiudi». */
const FERIE = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
/** Un forno vero: lun-sab 08-13, domenica chiuso. */
const FORNO = {
  mon: [['08:00', '13:00']], tue: [['08:00', '13:00']], wed: [['08:00', '13:00']],
  thu: [['08:00', '13:00']], fri: [['08:00', '13:00']], sat: [['08:00', '13:00']], sun: [],
};

const sabatoAlle10 = new Date(2026, 9, 31, 10, 0);
const martediAlle20 = new Date(2026, 10, 3, 20, 0);

describe('chiuso per ferie: la scheda non promette la consegna che la cassa rifiuta', () => {
  it('sabato 31/10 alle 10:00 la cassa è ferma e la scheda dice chiuso', () => {
    expect(isStoreClosedForOrder(FERIE, sabatoAlle10), 'la cassa').toBe(true);
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: FERIE, adesso: sabatoAlle10, veloce: null });
    expect(riga).toBe('Il negozio è chiuso ora');
    expect(riga).not.toMatch(/ora che scegli|in cassa scegli/);
  });

  it('anche con la veloce che risponde sì, la scheda non promette niente', () => {
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: FERIE, adesso: martediAlle20, veloce: true });
    expect(riga).toBe('Il negozio è chiuso ora');
  });

  it('la promessa è «chiuso», senza un «riapre» inventato', () => {
    expect(promessaDiConsegna({ idoneoExpress: true, disponibile: true, orari: FERIE, adesso: sabatoAlle10 }))
      .toEqual({ tipo: 'chiuso', riapre: null });
    expect(haOrari(FERIE)).toBe(true);
    expect(consegnaDellaVetrina({ orari: FERIE, adesso: sabatoAlle10, veloce: null })).toBeNull();
  });

  it('senza orari scritti, o con una settimana a metà, resta com era: «non lo so» non è «chiuso»', () => {
    for (const niente of [null, undefined, {}, { sun: [], mon: [] }]) {
      expect(haOrari(niente), JSON.stringify(niente)).toBe(false);
      expect(rigaConsegnaDellaScheda({ esaurito: false, orari: niente, adesso: sabatoAlle10, veloce: null }))
        .toBe('Consegna a casa, all\'ora che scegli');
    }
  });

  it('il forno aperto sabato alle 10 continua a promettere la consegna', () => {
    expect(haOrari(FORNO)).toBe(true);
    expect(rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: sabatoAlle10, veloce: null }))
      .not.toMatch(/chius/i);
  });
});
