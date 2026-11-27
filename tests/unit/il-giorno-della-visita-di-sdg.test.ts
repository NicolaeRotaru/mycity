import { describe, it, expect } from 'vitest';
import { eFesta, giorniDellaVisita, istanteAPiacenza, orarioDellaVisitaValido, scriviVisita, ORARI_VISITA } from '@/lib/agenzia/visita-sdg';

/**
 * 27/11/2026 verso le 17:40 — Nicola: nel link il titolare sceglie giorno e ora in cui il team creativo di SDG
 * passa da lui. I giorni e le ore li calcola il server (lib/agenzia/visita-sdg.ts). Casi (dato → atteso):
 *  · venerdì 27/11 alle 17:45 → da lunedì 30/11 (dopodomani è domenica) a venerdì 11/12, senza domeniche e
 *    senza l'8 dicembre; il 20/12 niente Natale, Santo Stefano e Capodanno (collaudo del 27/11);
 *  · tre orari, due ore fra uno e l'altro (la visita dura un'ora e mezza, la squadra è una);
 *  · gli orari sono quelli di Piacenza, anche col cambio dell'ora legale (29/3/2027);
 *  · un'ora presa resta in lista ma non libera; un giorno tutto preso sparisce;
 *  · valido solo un orario proposto adesso: non uno passato, non uno troppo vicino, non uno inventato;
 *  · «lunedì 30 novembre alle 10:00».
 */

const ADESSO = new Date('2026-11-27T16:45:00Z');

describe('i giorni e le ore della visita di SDG', () => {
  it('da dopodomani a due settimane, senza domeniche né feste, tre orari al giorno', () => {
    const giorni = giorniDellaVisita(ADESSO);
    expect(giorni.map((g) => g.giorno)).toEqual([
      '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05',
      '2026-12-07', '2026-12-09', '2026-12-10', '2026-12-11',
    ]);
    expect(giorni[0].lungo).toBe('lunedì 30 novembre');
    for (const g of giorni) expect(g.orari.map((o) => o.ora)).toEqual([...ORARI_VISITA]);
    // Le 10:00 di Piacenza d'inverno sono le 9:00 UTC.
    expect(giorni[0].orari[0].id).toBe('2026-11-30T09:00:00.000Z');
  });

  it('l ora di Piacenza regge al cambio dell ora legale', () => {
    expect(istanteAPiacenza(2027, 3, 27, 10, 0).toISOString()).toBe('2027-03-27T09:00:00.000Z');
    expect(istanteAPiacenza(2027, 3, 29, 10, 0).toISOString()).toBe('2027-03-29T08:00:00.000Z');
    expect(istanteAPiacenza(2027, 10, 30, 15, 0).toISOString()).toBe('2027-10-30T13:00:00.000Z');
    expect(istanteAPiacenza(2027, 11, 2, 15, 0).toISOString()).toBe('2027-11-02T14:00:00.000Z');
  });

  it('un ora presa non è libera; un giorno tutto preso sparisce', () => {
    const lunedi = giorniDellaVisita(ADESSO)[0].orari.map((o) => o.id);
    const conUna = giorniDellaVisita(ADESSO, [lunedi[0]]);
    expect(conUna[0].orari.map((o) => o.libero)).toEqual([false, true, true]);
    const tutto = giorniDellaVisita(ADESSO, lunedi);
    expect(tutto[0].giorno).toBe('2026-12-01');
    // Un valore rovinato nel database non rompe niente.
    expect(giorniDellaVisita(ADESSO, ['non è una data'])).toHaveLength(10);
  });

  it('valido solo un orario proposto adesso', () => {
    expect(orarioDellaVisitaValido('2026-11-30T09:00:00.000Z', ADESSO)).toBe(true);
    expect(orarioDellaVisitaValido('2026-11-28T09:00:00.000Z', ADESSO)).toBe(false); // domani: troppo presto
    expect(orarioDellaVisitaValido('2026-11-29T09:00:00.000Z', ADESSO)).toBe(false); // domenica
    expect(orarioDellaVisitaValido('2026-12-08T09:00:00.000Z', ADESSO)).toBe(false); // l'Immacolata
    expect(orarioDellaVisitaValido('2026-11-30T09:15:00.000Z', ADESSO)).toBe(false); // non è un orario proposto
    expect(orarioDellaVisitaValido('2026-12-14T09:00:00.000Z', ADESSO)).toBe(false); // oltre due settimane
    expect(orarioDellaVisitaValido('2026-11-30T09:00:00Z', ADESSO)).toBe(false); // scritto in un'altra forma
    expect(orarioDellaVisitaValido('', ADESSO)).toBe(false);
  });

  it('le feste: fisse, Pasquetta, Sant Antonino; e sotto Natale non si propongono', () => {
    for (const [a, m, g] of [[2026, 12, 8], [2026, 12, 25], [2026, 12, 26], [2027, 1, 1], [2027, 1, 6], [2027, 4, 25], [2027, 5, 1], [2027, 6, 2], [2027, 7, 4], [2027, 8, 15], [2027, 11, 1]]) {
      expect(eFesta(a, m, g), `${g}/${m}/${a}`).toBe(true);
    }
    // Pasquetta: 6 aprile 2026, 29 marzo 2027, 17 aprile 2028.
    expect(eFesta(2026, 4, 6)).toBe(true);
    expect(eFesta(2027, 3, 29)).toBe(true);
    expect(eFesta(2028, 4, 17)).toBe(true);
    expect(eFesta(2027, 3, 30)).toBe(false);
    expect(eFesta(2026, 12, 24)).toBe(false);
    // Il 20/12 la lista va dal 22/12 al 3/1: niente 25, 26 e 1/1 (né le domeniche 27/12 e 3/1).
    const natale = giorniDellaVisita(new Date('2026-12-20T10:00:00Z')).map((g) => g.giorno);
    expect(natale).toEqual(['2026-12-22', '2026-12-23', '2026-12-24', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-02']);
  });

  it('si scrive come lo si dice', () => {
    expect(scriviVisita('2026-11-30T09:00:00.000Z')).toBe('lunedì 30 novembre alle 10:00');
    expect(scriviVisita(new Date('2026-12-01T14:00:00.000Z'))).toBe('martedì 1 dicembre alle 15:00');
  });
});
