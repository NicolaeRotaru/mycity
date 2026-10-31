import { describe, it, expect } from 'vitest';
import { CONSEGNA_ALL_ORA_CHE_SCEGLI, rigaConsegnaDellaScheda } from '@/lib/promessa-consegna';
import { fasceAncoraPossibili, fasceDiDomaniPossibili } from '@/lib/quando-arriva';

/**
 * 31/10/2026 (ondata 3) — LA SCHEDA NON MANDA IN CASSA A SCEGLIERE UN'ORA CHE LA CASSA NON HA.
 *
 * La cassa propone solo le fasce di oggi e di domani (`fasceAncoraPossibili`,
 * `fasceDiDomaniPossibili`). Sabato 31/10 alle 21:30, forno lun-sab 08-13: oggi è finito e domenica
 * è chiuso, quindi la cassa ha zero fasce. La scheda diceva «Il negozio è chiuso ora, riapre lunedì
 * alle 08:00: in cassa scegli l'ora della consegna». Alle 12:59, a forno ancora aperto, diceva
 * «Consegna a casa, all'ora che scegli» con la stessa cassa vuota.
 *
 * Qui si eseguono le scene e poi si gira tutto il fine settimana, mezz'ora per mezz'ora: ogni volta
 * che la scheda parla dell'ora da scegliere, la cassa deve avere almeno una fascia.
 */

const H: [string, string][] = [['08:00', '13:00']];
const FORNO = { mon: H, tue: H, wed: H, thu: H, fri: H, sat: H, sun: [] };
const SCEGLI = /scegli l.ora|all.ora che scegli/i;

const fasceInCassa = (adesso: Date) =>
  fasceAncoraPossibili(adesso, [FORNO]).length + fasceDiDomaniPossibili(adesso, [FORNO]).length;
const riga = (adesso: Date, veloce: boolean | null = null) =>
  rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso, veloce });

describe('la scheda promette l’ora in cassa solo se la cassa ne ha una', () => {
  it('sabato 31/10 alle 21:30, domenica chiuso: cassa vuota, la scheda dice solo quando riapre', () => {
    const adesso = new Date(2026, 9, 31, 21, 30);
    expect(fasceInCassa(adesso), 'la cassa ha delle fasce').toBe(0);
    const r = riga(adesso);
    expect(r).toBe('Il negozio è chiuso ora, riapre lunedì alle 08:00');
    expect(r).not.toMatch(SCEGLI);
  });

  it('sabato alle 13:30, appena chiuso: stessa cassa vuota, stessa riga', () => {
    const adesso = new Date(2026, 9, 31, 13, 30);
    expect(fasceInCassa(adesso)).toBe(0);
    expect(riga(adesso)).not.toMatch(SCEGLI);
    expect(riga(adesso)).toContain('riapre lunedì alle 08:00');
  });

  it('sabato alle 12:59, forno ancora aperto ma cassa vuota: niente «all’ora che scegli»', () => {
    const adesso = new Date(2026, 9, 31, 12, 59);
    expect(fasceInCassa(adesso)).toBe(0);
    const r = riga(adesso);
    expect(r).not.toMatch(SCEGLI);
    expect(r).toBe('Le consegne di oggi sono finite, il negozio riapre lunedì alle 08:00');
  });

  it('dove la cassa ha le fasce, la scheda continua a mandarci', () => {
    // Venerdì sera: chiuso, ma domani (sabato) la cassa ha le fasce.
    expect(riga(new Date(2026, 9, 30, 21, 30))).toBe(
      "Il negozio è chiuso ora, riapre domani alle 08:00: in cassa scegli l'ora della consegna",
    );
    // Sabato alle 7: chiuso, riapre alle 8, e per oggi la cassa ha le fasce.
    expect(riga(new Date(2026, 9, 31, 7, 0))).toMatch(/riapre alle 08:00: in cassa scegli l'ora/);
    // Sabato alle 10: aperto, fasce di oggi.
    expect(riga(new Date(2026, 9, 31, 10, 0))).toBe(CONSEGNA_ALL_ORA_CHE_SCEGLI);
  });

  it('tutto il fine settimana, mezz’ora per mezz’ora: «scegli l’ora» solo con una fascia in cassa', () => {
    const sbagliate: string[] = [];
    for (let minuti = 0; minuti < 3 * 24 * 60; minuti += 30) {
      // Da venerdì 30/10 alle 00:00 a domenica 1/11 alle 23:30.
      const adesso = new Date(2026, 9, 30, 0, minuti);
      for (const veloce of [null, false, true] as const) {
        const r = riga(adesso, veloce) ?? '';
        if (SCEGLI.test(r) && fasceInCassa(adesso) === 0) sbagliate.push(`${adesso.toString().slice(0, 21)} → ${r}`);
      }
    }
    expect(sbagliate, 'la scheda manda in cassa a scegliere un’ora che la cassa non ha').toEqual([]);
  });
});
